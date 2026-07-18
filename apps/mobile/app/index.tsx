import "fast-text-encoding";
import "react-native-get-random-values";
import "@ethersproject/shims";

import Constants from "expo-constants";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { formatAmount, parseAmount, type CompiledRulebook, type MarketReferenceV1, type MarketSnapshot, type TicketSnapshot } from "@slip/sdk";

import { downloadAndShareAttachment, pickAndUploadAttachment } from "../src/media-transfer";
import { MobilePeerController, MobilePeerError, type PeerEvent } from "../src/peer-controller";
import {
  MobileNetworkManifestError,
  resolveNetworkManifest,
  type MobileNetworkConfig,
  type NetworkResolution,
} from "../src/network-manifest";
import { chronologicalPage } from "../src/room-order";
import { countryFlag } from "../src/country-flags";
import { inviteCodeFromInput } from "../src/invite-code";
import { generateDisplayName } from "../src/peer-identity";
import { PeerAvatar } from "../src/peer-avatar";
import { boothClipsForReleasedEvent, boothClipsForRoomMoment, catchMeUpClips } from "../src/match-voice";
import {
  enqueueMatchVoice,
  getApiKeySync,
  isMatchVoiceEnabledSync,
  loadMatchVoicePrefs,
  setElevenLabsApiKey,
  setMatchVoiceEnabled,
  testElevenLabsKey,
} from "../src/match-voice-player";
import { buyMobileTicket, claimMobileTicket, compileMobileRulebook, createMobileMarketReference, getMobileMarketPosition, loadMobileSlipWallet, verifyMobileMarketReference, type MobileSlipConfiguration, type MobileSlipWallet } from "../src/slip-wallet";
import { externalLinks, fetchMobileLinkPreview, type MobileLinkPreview } from "../src/link-preview";

type Json = Record<string, any>;
type RoomTab = "match" | "chat" | "polls" | "details";
type Screen = { kind: "home" } | { kind: "room"; roomId: string };
type PendingMobileMarket = {
  pollId: string;
  question: string;
  rulebook: Omit<CompiledRulebook, "bands"> & { bands: Array<{ lowerInclusive: string | null; upperExclusive: string | null; outcomeIndex: number }> };
  reference?: MarketReferenceV1;
};

const CONFIG_CACHE_KEY = "fulltime.network-manifest.v1";
const DEVICE_SECRET_KEY = "fulltime.device-secret.v1";
/** Worker boot label only — real identity is set at sign-in with a generated peer name. */
const DEFAULT_DISPLAY_NAME = "FullTime Fan";
// Privy packages and native configuration stay installed, but its runtime import
// remains out of the mobile bundle until that signing path is resumed.
const QUICK_REACTIONS = ["🔥", "⚽", "👏", "😮"];
const BRAND_DOTS = ["#2A7656", "#3457D5", "#D29B36", "#B62931", "#3457D5", "#2A7656", "#D29B36", "#B62931"];

function BrandMark({ size = 38 }: { size?: number }) {
  const center = size / 2;
  const orbit = size * 0.39;
  const dot = Math.max(4, Math.round(size * 0.13));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {BRAND_DOTS.map((color, index) => {
        const angle = (index / BRAND_DOTS.length) * Math.PI * 2;
        return <View key={`${color}-${index}`} style={{ position: "absolute", width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, left: center + Math.sin(angle) * orbit - dot / 2, top: center - Math.cos(angle) * orbit - dot / 2, borderWidth: 1, borderColor: colors.parchment }} />;
      })}
      <View style={{ position: "absolute", left: size * 0.24, top: size * 0.24, width: size * 0.52, height: size * 0.52, borderRadius: size * 0.26, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.parchment, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.17, height: size * 0.17, backgroundColor: colors.ink, transform: [{ rotate: "45deg" }] }} />
      </View>
    </View>
  );
}

function Wordmark() {
  const markSize = Platform.OS === "android" ? 34 : 38;
  return <View style={styles.brand}><BrandMark size={markSize} /><Text style={styles.wordmark}>FullTime.</Text></View>;
}

function CountryFlag({ country, teamName, size = 34 }: { country?: string | null; teamName?: string | null; size?: number }) {
  const flag = countryFlag(country, teamName);
  if (!flag) return <View style={[styles.countryFlag, { width: size, height: size, borderRadius: size / 2 }]} />;
  return <View accessibilityLabel={`${teamName ?? country ?? "Country"} flag`} style={[styles.countryFlag, { width: size, height: size, borderRadius: size / 2 }]}><Text style={{ fontSize: Math.round(size * 0.72), lineHeight: size }}>{flag}</Text></View>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function serializePendingRulebook(rulebook: CompiledRulebook): PendingMobileMarket["rulebook"] {
  return { ...rulebook, bands: rulebook.bands.map((band) => ({ lowerInclusive: band.lowerInclusive?.toString() ?? null, upperExclusive: band.upperExclusive?.toString() ?? null, outcomeIndex: band.outcomeIndex })) };
}

function deserializePendingRulebook(rulebook: PendingMobileMarket["rulebook"]): CompiledRulebook {
  return { ...rulebook, bands: rulebook.bands.map((band) => ({ lowerInclusive: band.lowerInclusive === null ? null : BigInt(band.lowerInclusive), upperExclusive: band.upperExclusive === null ? null : BigInt(band.upperExclusive), outcomeIndex: band.outcomeIndex })) };
}

function storagePath(): string {
  const uri = FileSystem.documentDirectory;
  if (!uri) throw new Error("FullTime cannot access protected app storage on this device.");
  return decodeURIComponent(uri.replace(/^file:\/\//, "")) + "fulltime-peer";
}

async function deviceSecret(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
  if (stored && /^[a-f0-9]{64}$/.test(stored)) {
    return Uint8Array.from(stored.match(/../g)!.map((value) => Number.parseInt(value, 16)));
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(DEVICE_SECRET_KEY, hex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return bytes;
}

function networkConfig(): MobileNetworkConfig {
  const value = Constants.expoConfig?.extra?.fullTimeNetwork as Partial<MobileNetworkConfig> | undefined;
  return {
    endpoint: typeof value?.endpoint === "string" ? value.endpoint : null,
    publicKey: typeof value?.publicKey === "string" ? value.publicKey : null,
    initialManifest: value?.initialManifest && typeof value.initialManifest === "object"
      ? value.initialManifest
      : null,
    fixtureRelay: value?.fixtureRelay && typeof value.fixtureRelay === "object"
      ? value.fixtureRelay as { host: string; port: number }
      : undefined,
  };
}

function usePeer(epoch: number) {
  const controller = useRef<MobilePeerController | null>(null);
  const [stage, setStage] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<NetworkResolution | null>(null);
  const [transport, setTransport] = useState<Json>({ status: "starting", peerCount: 0 });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const peer = new MobilePeerController();
    controller.current = peer;
    const unsubscribe = peer.subscribe((event: PeerEvent) => {
      if (!active) return;
      if (event.type === "transport.status") setTransport(event);
      if (["fixture.updated", "room.state", "room.details"].includes(event.type)) setRevision((value) => value + 1);
      if (event.type === "room.error" && event.recoverable === false) setError(String(event.message));
    });

    void (async () => {
      try {
        const config = networkConfig();
        const next = await resolveNetworkManifest(config, {
          read: () => SecureStore.getItemAsync(CONFIG_CACHE_KEY),
          write: (value) => SecureStore.setItemAsync(CONFIG_CACHE_KEY, value, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        });
        if (!active) return;
        setResolution(next);
        await peer.start({
          storagePath: storagePath(),
          displayName: DEFAULT_DISPLAY_NAME,
          deviceSecret: await deviceSecret(),
          manifest: next.manifest,
          fixtureRelay: config.fixtureRelay,
        });
        if (active) setStage("ready");
      } catch (reason) {
        if (!active) return;
        setError(message(reason));
        setStage("error");
      }
    })();

    return () => {
      active = false;
      unsubscribe();
      void peer.close();
      controller.current = null;
    };
  }, [epoch]);

  const request = useCallback(<T,>(action: string, payload: unknown = null) => {
    if (!controller.current) return Promise.reject(new MobilePeerError("WORKER_UNAVAILABLE", "Peer worker is not ready", false));
    return controller.current.request<T>(action, payload);
  }, []);

  return { stage, error, resolution, transport, revision, request };
}

export default function App() {
  return <SafeAreaProvider><FullTimeApp /></SafeAreaProvider>;
}

function FullTimeApp() {
  const [peerEpoch, setPeerEpoch] = useState(0);
  const peer = usePeer(peerEpoch);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [session, setSession] = useState<Json | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void loadMatchVoicePrefs();
  }, []);

  const resetAccount = async () => {
    const source = storagePath();
    const info = await FileSystem.getInfoAsync(source);
    if (info.exists) await FileSystem.moveAsync({ from: source, to: `${source}-archive-${Date.now()}` });
    await SecureStore.deleteItemAsync(DEVICE_SECRET_KEY);
    setSession(null); setScreen({ kind: "home" }); setSettingsOpen(false); setPeerEpoch((value) => value + 1);
  };

  const refreshSession = useCallback(async () => {
    if (peer.stage === "ready") setSession(await peer.request<Json | null>("session.get"));
  }, [peer.request, peer.stage]);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  if (peer.stage !== "ready") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <Text style={styles.eyebrow}>{peer.stage === "error" ? "CONFIGURATION UNAVAILABLE" : "PRIVATE PEER STARTING"}</Text>
          <Text style={styles.hero}>{peer.stage === "error" ? "FullTime cannot open peer rooms yet." : "Opening your mobile peer."}</Text>
          {peer.stage === "starting" ? <ActivityIndicator color={colors.ink} style={styles.spinner} /> : null}
          {peer.error ? <Text style={styles.centerCopy}>{peer.error}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {screen.kind === "home" ? (
        <Home peer={peer} session={session} onSession={setSession} onSettings={() => setSettingsOpen(true)} onOpenRoom={(roomId) => setScreen({ kind: "room", roomId })} />
      ) : (
        <RoomScreen peer={peer} roomId={screen.roomId} session={session} onSession={setSession} onSettings={() => setSettingsOpen(true)} onBack={() => setScreen({ kind: "home" })} />
      )}
      <AccountSettings open={settingsOpen} session={session} request={peer.request} onSession={setSession} onClose={() => setSettingsOpen(false)} onReset={resetAccount} />
    </SafeAreaView>
  );
}

function Home({ peer, session, onSession, onSettings, onOpenRoom }: { peer: ReturnType<typeof usePeer>; session: Json | null; onSession(value: Json | null): void; onSettings(): void; onOpenRoom(roomId: string): void }) {
  const [mode, setMode] = useState<"home" | "join" | "create">("home");
  const [fixtures, setFixtures] = useState<Json[]>([]);
  const [rooms, setRooms] = useState<Json[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => generateDisplayName());
  const [invite, setInvite] = useState("");
  const [invitePreview, setInvitePreview] = useState<Json | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [fixtureResult, roomResult] = await Promise.allSettled([
      peer.request<Json[]>("fixture.list", {}),
      peer.request<Json[]>("room.list", null),
    ]);
    if (fixtureResult.status === "fulfilled") setFixtures(fixtureResult.value);
    if (roomResult.status === "fulfilled") setRooms(roomResult.value);
    if (roomResult.status === "rejected") setError(message(roomResult.reason));
    else if (fixtureResult.status === "rejected") setError(`Match schedule unavailable: ${message(fixtureResult.reason)}`);
  }, [peer.request]);

  useEffect(() => { void load(); }, [load, peer.revision]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };

  if (!session) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.onboarding} keyboardShouldPersistTaps="handled">
          <Wordmark />
          <Text style={styles.eyebrow}>YOUR DEVICE · YOUR IDENTITY</Text>
          <Text style={styles.hero}>The match room that belongs to the people in it.</Text>
          <Text style={styles.bodyMuted}>We generated a name and mark for this device. Keep them, reshuffle, or type your own — your Pear identity still signs what you send.</Text>
          <View style={styles.peerPreview}>
            <PeerAvatar userId={`preview:${displayName}`} displayName={displayName || "Peer"} size="lg" isCurrentUser />
            <View style={styles.peerPreviewCopy}>
              <Text style={styles.cardEyebrow}>YOU WILL APPEAR AS</Text>
              <Text style={styles.peerPreviewName} numberOfLines={1}>{displayName.trim() || "…"}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Generate another name"
              onPress={() => setDisplayName(generateDisplayName())}
              style={styles.reshuffleButton}
            >
              <Text style={styles.reshuffleText}>NEW</Text>
            </Pressable>
          </View>
          <Field value={displayName} onChangeText={setDisplayName} placeholder="Dancing Meadow" maxLength={48} autoComplete="nickname" />
          <Button label={busy ? "Opening identity…" : "Enter FullTime"} disabled={!displayName.trim() || busy} onPress={() => void run(async () => {
            const next = await peer.request<Json>("session.sign-in", { displayName: displayName.trim() });
            onSession(next);
          })} />
          {error ? <ErrorText text={error} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const create = () => run(async () => {
    if (!selectedFixture || !roomName.trim()) return;
    const details = await peer.request<Json>("room.create", { fixtureId: selectedFixture, roomName: roomName.trim(), displayName: session.displayName });
    onOpenRoom(String(details.room.id));
  });
  const join = () => run(async () => {
    const room = await peer.request<Json>("room.join", { code: inviteCodeFromInput(invite) });
    onOpenRoom(String(room.room.id));
  });

  if (mode === "join") {
    return <ScrollView contentContainerStyle={styles.focusFlow} keyboardShouldPersistTaps="handled">
      <FlowHeader eyebrow="JOIN A ROOM" title={invitePreview ? "Room found." : "Bring the invite."} onBack={() => { setMode("home"); setError(null); }} />
      {invitePreview ? (
        <Card>
          <View style={styles.invitePreview}>
            <Text style={styles.cardEyebrow}>INVITE VERIFIED</Text>
            <Text style={styles.detailsTitle}>{invitePreview.room?.name}</Text>
            <Text style={styles.bodyMuted}>{invitePreview.fixture?.competition}</Text>
            <Text style={styles.cardTitle}>{invitePreview.fixture?.home?.name} vs {invitePreview.fixture?.away?.name}</Text>
            <Text style={styles.bodyMuted}>{invitePreview.members} {Number(invitePreview.members) === 1 ? "member" : "members"} in the room</Text>
          </View>
          <Button label={busy ? "Joining…" : "Join room"} disabled={busy} onPress={join} />
          <Button quiet label="Scan a different room" disabled={busy} onPress={() => { setInvite(""); setInvitePreview(null); setScannerOpen(true); }} />
        </Card>
      ) : (
        <>
          <Text style={styles.bodyMuted}>Scan the room QR or paste its invite. FullTime verifies the invite before joining.</Text>
          <Card>
            <Button label="Scan QR code" disabled={busy} onPress={() => setScannerOpen(true)} />
            <Text style={styles.cardEyebrow}>OR PASTE AN INVITE</Text>
            <Field value={invite} onChangeText={setInvite} placeholder="Paste room invite" multiline returnKeyType="done" submitBehavior="blurAndSubmit" />
            <Button quiet label={busy ? "Checking…" : "Join with pasted invite"} disabled={!invite.trim() || busy} onPress={join} />
          </Card>
        </>
      )}
      {scannerOpen ? <InviteScanner request={peer.request} onClose={() => setScannerOpen(false)} onInvite={(code, preview) => { setInvite(code); setInvitePreview(preview); setScannerOpen(false); }} /> : null}
      {error ? <ErrorText text={error} /> : null}
    </ScrollView>;
  }

  if (mode === "create") {
    const selected = fixtures.find((card) => String(card.fixture.id) === selectedFixture);
    return <ScrollView contentContainerStyle={styles.focusFlow} keyboardShouldPersistTaps="handled"><FlowHeader eyebrow={selected ? "STEP 2 OF 2" : "STEP 1 OF 2"} title={selected ? "Make it your room." : "Pick the match."} onBack={() => { if (selected) { setSelectedFixture(null); setRoomName(""); } else setMode("home"); setError(null); }} />{selected ? <><FixtureCard card={selected} selected onPress={() => undefined} /><Card><Text style={styles.cardEyebrow}>ROOM NAME</Text><Field value={roomName} onChangeText={setRoomName} placeholder="e.g. The Away End" maxLength={48} /><Button label={busy ? "Creating…" : "Create private room"} disabled={!roomName.trim() || busy} onPress={create} /><Text style={styles.hint}>Only people you invite can enter.</Text></Card></> : <>{fixtures.length === 0 ? <Empty text="Waiting for the match schedule." /> : fixtures.map((card) => { const id = String(card.fixture.id); return <FixtureCard key={id} card={card} selected={false} onPress={() => { setSelectedFixture(id); setRoomName(`${card.fixture.home.name} × ${card.fixture.away.name}`); }} />; })}</>}{error ? <ErrorText text={error} /> : null}</ScrollView>;
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.ink} />} contentContainerStyle={styles.home} keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <Wordmark />
        <View style={styles.headerActions}><View accessibilityLabel={`${String(peer.transport.status)}, ${Number(peer.transport.peerCount || 0)} peers`} style={styles.transport}><View style={[styles.dot, peer.transport.status === "online" && styles.dotOnline]} /><Text style={styles.transportText}>{Number(peer.transport.peerCount || 0)} peers</Text></View><SettingsButton onPress={onSettings} /></View>
      </View>
      {peer.resolution?.stale ? <Banner text="SIGNED NETWORK CONFIG · CACHED" /> : null}
      <Text style={styles.eyebrow}>WELCOME BACK</Text>
      <View style={styles.welcomeRow}>
        <PeerAvatar userId={session.userId} displayName={session.displayName} size="lg" isCurrentUser />
        <Text style={[styles.heading, styles.welcomeName]} numberOfLines={2}>{session.displayName}</Text>
      </View>

      <View style={styles.homeActions}><Pressable onPress={() => setMode("create")} style={styles.homeActionPrimary}><Text style={[styles.homeActionEyebrow, styles.homeActionLight]}>START A ROOM</Text><Text style={[styles.homeActionTitle, styles.homeActionLight]}>Choose a match</Text><Text style={[styles.homeActionArrow, styles.homeActionLight]}>›</Text></Pressable><Pressable onPress={() => setMode("join")} style={styles.homeAction}><Text style={styles.homeActionEyebrow}>HAVE AN INVITE?</Text><Text style={styles.homeActionTitle}>Join a room</Text><Text style={styles.homeActionArrow}>›</Text></Pressable></View>
      <SectionTitle eyebrow="YOUR ROOMS" title={rooms.length ? "Back to the match." : "No rooms yet."} />
      {rooms.length ? rooms.map((room) => <RoomRow key={String(room.room.id)} room={room} onPress={() => onOpenRoom(String(room.room.id))} />) : <Empty text="Create a room for a fixture or join one with an invite." />}
      {error ? <ErrorText text={error} /> : null}
    </ScrollView>
  );
}

function FlowHeader({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack(): void }) { return <View style={styles.flowHeader}><Pressable onPress={onBack} style={styles.flowBack}><Text style={styles.flowBackText}>‹</Text></Pressable><View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.heading}>{title}</Text></View></View>; }

function InviteScanner({ request, onClose, onInvite }: { request: ReturnType<typeof usePeer>["request"]; onClose(): void; onInvite(code: string, preview: Json): void }) {
  const [permission, askPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scanned = async (result: BarcodeScanningResult) => {
    if (!scanning) return;
    setScanning(false); setError(null);
    try {
      const code = inviteCodeFromInput(result.data);
      const preview = await request<Json>("room.preview-invite", { code });
      onInvite(code, preview);
    } catch (reason) {
      setError(message(reason));
    }
  };

  return <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}><SafeAreaView style={styles.scannerSafe}><View style={styles.scannerHeader}><View><Text style={styles.eyebrowLight}>ENCRYPTED ROOM INVITE</Text><Text style={styles.scannerTitle}>Scan to join.</Text></View><Pressable onPress={onClose} style={styles.threadClose}><Text style={styles.scannerClose}>×</Text></Pressable></View>{!permission ? <View style={styles.scannerCenter}><ActivityIndicator color={colors.white} /></View> : !permission.granted ? <View style={styles.scannerCenter}><Text style={styles.scannerCopy}>FullTime needs camera access only to read the room invite QR code.</Text><Button label="Allow camera" onPress={() => void askPermission()} /><Button quiet label="Cancel" onPress={onClose} /></View> : <View style={styles.cameraFrame}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanning ? (result) => void scanned(result) : undefined} /><View pointerEvents="none" style={styles.scanTarget}><View style={styles.scanCorners} /></View></View>}{error ? <View style={styles.scannerError}><ErrorText text={error} /><Button label="Scan again" onPress={() => { setError(null); setScanning(true); }} /></View> : null}<Text style={styles.scannerHint}>Point the camera at a FullTime invite QR. The worker verifies the signed invite before join is enabled.</Text></SafeAreaView></Modal>;
}

function RoomScreen({ peer, roomId, session, onSession, onSettings, onBack }: { peer: ReturnType<typeof usePeer>; roomId: string; session: Json | null; onSession(value: Json | null): void; onSettings(): void; onBack(): void }) {
  const [tab, setTab] = useState<RoomTab>("chat");
  const [room, setRoom] = useState<Json | null>(null);
  const [state, setState] = useState<Json | null>(null);
  const [details, setDetails] = useState<Json | null>(null);
  const [history, setHistory] = useState<Json[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true); setError(null);
    try {
      const [nextRoom, nextState, nextDetails, page] = await Promise.all([
        peer.request<Json | null>("room.get", { roomId }),
        peer.request<Json>("room.state", { roomId }),
        peer.request<Json | null>("room.details", { roomId }),
        peer.request<Json>("room.history.page", { roomId, limit: 100 }),
      ]);
      setRoom(nextRoom); setState(nextState); setDetails(nextDetails); setHistory(chronologicalPage(page.items));
    } catch (reason) { setError(message(reason)); }
    finally { setRefreshing(false); }
  }, [peer.request, roomId]);

  useEffect(() => { void load(); }, [load, peer.revision]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); await load(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };

  if (!room || !state || !details) {
    return <View style={styles.flex}><RoomHeader room={room} state={state} onBack={onBack} onSettings={onSettings} /><View style={styles.center}>{refreshing ? <ActivityIndicator color={colors.ink} /> : <ErrorText text={error ?? "This room is unavailable on this device."} />}</View></View>;
  }

  const fixture = state.fixture?.fixture ?? room.fixture;
  const polls = history.filter((item) => item.kind === "poll");
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={4}>
      <RoomHeader room={room} state={state} onBack={onBack} onSettings={onSettings} onInvite={() => setTab("details")} />
      <View style={styles.fixtureBar}>
        <Text numberOfLines={1} style={styles.fixtureBarText}>{fixture.home.shortName ?? fixture.home.name}  <Text style={styles.fixtureBarScore}>{state.fixture?.score ? `${state.fixture.score.home}–${state.fixture.score.away}` : "vs"}</Text>  {fixture.away.shortName ?? fixture.away.name}</Text>
        <Text style={[styles.fixtureBarMeta, state.fixture?.phase === "live" && styles.live]}>{state.fixture?.minute != null ? `${state.fixture.minute}′` : String(state.fixture?.status ?? fixture.competition).replace(/-/g, " ").toUpperCase()}</Text>
      </View>
      <View style={styles.tabs}>
        {(["chat", "polls", "match", "details"] as RoomTab[]).map((value) => (
          <Pressable key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabActive]}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>{value === "details" ? "ROOM" : value.toUpperCase()}{value === "chat" && state.unreadState?.count ? ` ${state.unreadState.count}` : value === "polls" && polls.length ? ` ${polls.length}` : ""}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <ErrorText text={error} compact /> : null}
      {tab === "match" ? <MatchTab state={state} busy={busy} onAnswer={(callId, optionId) => run(async () => { await peer.request("room.answer.submit", { roomId, callId, optionId }); })} onRefresh={load} refreshing={refreshing} /> : null}
      {tab === "chat" ? <ChatTab roomId={roomId} items={history} state={state} closed={details.isClosed} busy={busy} onRun={run} request={peer.request} onRefresh={load} refreshing={refreshing} /> : null}
      {tab === "polls" ? <PollTab roomId={roomId} items={polls} busy={busy} onRun={run} request={peer.request} onRefresh={load} refreshing={refreshing} /> : null}
      {tab === "details" ? <DetailsTab roomId={roomId} details={details} busy={busy} onRun={run} request={peer.request} onBack={onBack} onSession={onSession} onRefresh={load} refreshing={refreshing} /> : null}
    </KeyboardAvoidingView>
  );
}

function RoomHeader({ room, state, onBack, onSettings, onInvite }: { room: Json | null; state: Json | null; onBack(): void; onSettings(): void; onInvite?: () => void }) {
  const name = room?.room?.name ?? "Private room";
  return <View style={styles.roomHeader}>
    <Pressable onPress={onBack} style={styles.roundButton}><Text style={styles.roundButtonText}>‹</Text></Pressable>
    <View style={styles.roomHeaderTitle}><Text numberOfLines={1} style={styles.roomName}>🔒 {name}</Text><Text style={styles.roomMeta}>ENCRYPTED PEAR ROOM</Text></View>
    <View style={styles.memberPill}><Text style={styles.memberPillText}>♙ {state?.members?.length ?? room?.members ?? 0}</Text></View>
    <SettingsButton onPress={onSettings} />
    {onInvite ? <Pressable onPress={onInvite} style={styles.inviteButton}><Text style={styles.inviteButtonText}>INVITE</Text></Pressable> : null}
  </View>;
}

function SettingsButton({ onPress }: { onPress(): void }) {
  return <Pressable onPress={onPress} style={styles.settingsButton} accessibilityRole="button" accessibilityLabel="Account settings"><Text style={styles.settingsGlyph}>⚙</Text></Pressable>;
}

function AccountSettings({ open, session, request, onSession, onClose, onReset }: { open: boolean; session: Json | null; request: ReturnType<typeof usePeer>["request"]; onSession(value: Json | null): void; onClose(): void; onReset(): Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyOk, setKeyOk] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(String(session?.displayName ?? ""));
    setError(null);
    void loadMatchVoicePrefs().then((prefs) => {
      setVoiceOn(prefs.enabled);
      setApiKey(prefs.apiKey ?? "");
      setKeyOk(Boolean(prefs.apiKey));
    });
  }, [open, session?.displayName]);
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(null); try { await action(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); } };
  return <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.settingsHeader}><View><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.heading}>Settings</Text></View><Pressable onPress={onClose} style={styles.threadClose}><Text style={styles.threadCloseText}>×</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.settingsContent} keyboardShouldPersistTaps="handled">
        {session ? <>
          <Card>
            <View style={styles.peerPreview}>
              <PeerAvatar userId={session.userId} displayName={name || session.displayName} size="lg" isCurrentUser />
              <View style={styles.peerPreviewCopy}>
                <Text style={styles.cardEyebrow}>PEER LOOK</Text>
                <Text style={styles.peerPreviewName} numberOfLines={1}>{name.trim() || session.displayName}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Generate another name" onPress={() => setName(generateDisplayName())} style={styles.reshuffleButton}>
                <Text style={styles.reshuffleText}>NEW</Text>
              </Pressable>
            </View>
            <Text style={styles.cardEyebrow}>DISPLAY NAME</Text>
            <Field value={name} onChangeText={setName} placeholder="Dancing Meadow" maxLength={48} autoComplete="nickname" />
            <Button label={busy ? "Saving…" : "Save name"} disabled={busy || !name.trim() || name.trim() === session.displayName} onPress={() => void run(async () => onSession(await request<Json>("session.sign-in", { displayName: name.trim() })))} />
          </Card>
          <Card><Text style={styles.cardEyebrow}>ACCOUNT ID</Text><Text selectable style={styles.accountId}>{session.userId}</Text></Card>
        </> : <Empty text="Sign in to manage peer identity. Match voice works without signing in." />}

        <Card>
          <Text style={styles.cardEyebrow}>ROOM RADIO · ELEVENLABS</Text>
          <Text style={styles.bodyMuted}>This room has a booth — not stadium PA. Ambient lines for stands, markets, and released events with odds. Your book only speaks your open stands and Fan IQ streak. Peers still write; radio keeps eyes on the TV. Paste your ElevenLabs key (stays on this phone).</Text>
          <Pressable
            onPress={() => void run(async () => {
              const next = !voiceOn;
              await setMatchVoiceEnabled(next);
              setVoiceOn(next);
            })}
            style={styles.voiceToggleRow}
          >
            <Text style={styles.body}>{voiceOn ? "● Room radio on" : "○ Room radio off"}</Text>
            <Text style={styles.smallAction}>{voiceOn ? "DISABLE" : "ENABLE"}</Text>
          </Pressable>
          <Field value={apiKey} onChangeText={setApiKey} placeholder="sk_… ElevenLabs API key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Button label={busy ? "Checking…" : "Save & test key"} disabled={busy || !apiKey.trim()} onPress={() => void run(async () => {
            const result = await testElevenLabsKey(apiKey.trim());
            if (!result.ok) throw new Error(result.error);
            await setElevenLabsApiKey(apiKey.trim());
            setKeyOk(true);
          })} />
          {keyOk ? <Text style={styles.hint}>Key saved · booth + your book ready</Text> : <Text style={styles.hint}>Without a key, room radio stays silent on mobile</Text>}
          {keyOk ? <Button quiet label="Clear key" disabled={busy} onPress={() => void run(async () => { await setElevenLabsApiKey(null); setApiKey(""); setKeyOk(false); })} /> : null}
        </Card>

        {session ? <>
          <Button quiet label="Sign out" disabled={busy} onPress={() => void run(async () => { await request("session.sign-out", null); onSession(null); onClose(); })} />
          <Card><Text style={[styles.cardEyebrow, styles.dangerText]}>DANGER ZONE</Text><Text style={styles.bodyMuted}>Archives this iPhone’s peer store and creates a new device identity.</Text><Button quiet label="Reset account" disabled={busy} onPress={() => Alert.alert("Reset this account?", "The existing peer store will be archived. FullTime will create a new identity on this iPhone.", [{ text: "Cancel", style: "cancel" }, { text: "Reset", style: "destructive", onPress: () => void run(onReset) }])} /></Card>
        </> : <Button label="Close" onPress={onClose} />}
        {error ? <ErrorText text={error} /> : null}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

function MatchTab({ state, busy, onAnswer, onRefresh, refreshing }: { state: Json; busy: boolean; onAnswer(callId: string, optionId: string): Promise<void>; onRefresh(): Promise<void>; refreshing: boolean }) {
  const [showAllCalls, setShowAllCalls] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => isMatchVoiceEnabledSync());
  const card = state.fixture;
  const fixture = card.fixture;
  const calls = state.calls ?? [];
  const featuredCalls = showAllCalls ? calls : calls.filter((view: Json) => view.status === "open").slice(0, 1).concat(calls.filter((view: Json) => view.status !== "open").slice(-1));
  const timeline = state.timeline ?? [];
  const marketSays = state.marketSays ?? [];
  const visibleTimeline = showTimeline ? timeline : timeline.slice(-3);
  const seenVoice = useRef<Set<string>>(new Set());
  const seenMarkets = useRef<Set<string>>(new Set());
  const seenAnswers = useRef<Set<string>>(new Set());
  const catchUpDone = useRef(false);

  useEffect(() => {
    setVoiceOn(isMatchVoiceEnabledSync());
  }, []);

  useEffect(() => {
    if (!isMatchVoiceEnabledSync() || !getApiKeySync()) return;
    const home = String(fixture?.home?.name ?? "Home");
    const away = String(fixture?.away?.name ?? "Away");
    const teams = { home, away };

    if (!catchUpDone.current) {
      catchUpDone.current = true;
      for (const event of timeline) seenVoice.current.add(String(event.id ?? event.messageId ?? ""));
      for (const m of marketSays) seenMarkets.current.add(String(m.id));
      for (const c of calls) {
        if (c.myAnswer) seenAnswers.current.add(String(c.myAnswer.answerId ?? c.call?.id));
      }
      const openCall = [...calls].reverse().find((c: Json) => c.status === "open" && Number(c.total) > 0);
      let majoritySide: string | null = null;
      let majorityShare: number | null = null;
      if (openCall) {
        let best = 0;
        for (const opt of openCall.call?.options ?? []) {
          const n = Number(openCall.tally?.[opt.id] ?? 0);
          if (n > best) {
            best = n;
            majoritySide = String(opt.label);
            majorityShare = openCall.total ? best / Number(openCall.total) : null;
          }
        }
      }
      enqueueMatchVoice(catchMeUpClips({
        teams,
        phase: String(card.phase ?? "live"),
        statusLabel: String(card.status ?? "").replace(/-/g, " "),
        score: card.score ?? null,
        minute: card.minute ?? null,
        majoritySide,
        majorityShare,
        hottestMarketLine: marketSays.length ? String(marketSays[marketSays.length - 1]?.text ?? "") : null,
        lastBigCall: calls.length ? String(calls[calls.length - 1]?.call?.prompt ?? "") : null,
      }));
      return;
    }

    for (const event of timeline) {
      const id = String(event.id ?? event.messageId ?? "");
      if (!id || seenVoice.current.has(id)) continue;
      seenVoice.current.add(id);
      const impact = ["goal", "own-goal", "penalty-scored", "red-card", "second-yellow"].includes(String(event.kind ?? event.type));
      const mine = calls.filter((c: Json) => c.status === "open" && c.myAnswer);
      const standLabel = mine[0]
        ? String((mine[0].call?.options ?? []).find((o: Json) => o.id === mine[0].myAnswer?.optionId)?.label ?? mine[0].call?.prompt ?? "")
        : null;
      const clips = boothClipsForReleasedEvent({
        event,
        teams,
        marketText: marketSays.length ? String(marketSays[marketSays.length - 1]?.text ?? "") : null,
        openStandsTouching: calls.filter((c: Json) => c.status === "open" && Number(c.total) > 0).length,
        personal: {
          hasOpenStand: mine.length > 0,
          standLabel,
          underPressure: mine.length > 0 && impact,
          youreUpIfHolds: mine.length > 0 && ["goal", "penalty-scored"].includes(String(event.kind ?? event.type)),
          streakLength: 0,
          streakAtRisk: false,
        },
      });
      if (clips.length) enqueueMatchVoice(clips);
    }

    for (const m of marketSays) {
      const id = String(m.id);
      if (seenMarkets.current.has(id)) continue;
      seenMarkets.current.add(id);
      enqueueMatchVoice(boothClipsForRoomMoment({ kind: "market-says", label: String(m.text ?? "") }));
    }

    for (const c of calls) {
      if (!c.myAnswer) continue;
      const aid = String(c.myAnswer.answerId ?? `${c.call?.id}:mine`);
      if (seenAnswers.current.has(aid)) continue;
      seenAnswers.current.add(aid);
      const label = String((c.call?.options ?? []).find((o: Json) => o.id === c.myAnswer?.optionId)?.label ?? c.call?.prompt ?? "stand");
      enqueueMatchVoice(boothClipsForRoomMoment({ kind: "stand-locked", label, detail: String(c.call?.prompt ?? ""), personal: true }));
    }
  }, [timeline, marketSays, calls, fixture?.home?.name, fixture?.away?.name, card.phase, card.status, card.score, card.minute]);

  return <ScrollView style={styles.flex} contentContainerStyle={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}>
    <Pressable
      style={styles.voiceChip}
      onPress={() => void (async () => {
        const next = !voiceOn;
        await setMatchVoiceEnabled(next);
        setVoiceOn(next);
      })()}
    >
      <Text style={styles.voiceChipText}>{voiceOn ? (getApiKeySync() ? "📻 ROOM RADIO ON" : "📻 RADIO ON · ADD KEY") : "🔇 ROOM RADIO"}</Text>
    </Pressable>
    <View style={styles.scoreCard}>
      <View style={styles.team}><CountryFlag country={fixture.home.country} teamName={fixture.home.name} /><Text style={styles.teamCode}>{fixture.home.shortName ?? fixture.home.country ?? fixture.home.name.slice(0, 3).toUpperCase()}</Text><Text style={styles.teamName}>{fixture.home.name}</Text></View>
      <View style={styles.scoreCenter}><Text style={styles.score}>{card.score ? `${card.score.home} — ${card.score.away}` : "—"}</Text><Text style={styles.liveState}>{card.phase === "live" ? `● ${card.minute != null ? `${card.minute}′` : "LIVE"}` : String(card.status).replace(/-/g, " ").toUpperCase()}</Text></View>
      <View style={styles.team}><CountryFlag country={fixture.away.country} teamName={fixture.away.name} /><Text style={styles.teamCode}>{fixture.away.shortName ?? fixture.away.country ?? fixture.away.name.slice(0, 3).toUpperCase()}</Text><Text style={styles.teamName}>{fixture.away.name}</Text></View>
      <View style={styles.iqStrip}><View style={styles.iqCell}><Text style={styles.iqLabel}>FAN IQ</Text><Text style={styles.iqValue}>{state.fanIq?.scoredCalls ? Number(state.fanIq.fanIq) : "—"}</Text></View><View style={styles.iqCell}><Text style={styles.iqLabel}>ACCURACY</Text><Text style={styles.iqValue}>{state.fanIq?.scoredCalls ? `${Math.round(Number(state.fanIq.accuracy) * 100)}%` : "—"}</Text></View><View style={styles.iqCell}><Text style={styles.iqLabel}>ROOM RANK</Text><Text style={styles.iqValue}>{state.fanIq?.roomRank ? `#${state.fanIq.roomRank}` : "—"}</Text></View></View>
    </View>

    <SectionTitle eyebrow="SIGNED CALLS" title="Make the read." />
    {!state.attestationAvailable ? <Banner text="CALLS ARE VERIFIED · ANSWERS NEED A PINNED ATTESTOR" /> : null}
    {calls.length === 0 ? <Empty text="Calls appear when the match opens one." /> : null}
    {featuredCalls.map((view: Json) => <CallCard key={String(view.call.id)} view={view} disabled={busy} attestationAvailable={Boolean(state.attestationAvailable)} onSelect={(optionId) => onAnswer(String(view.call.id), optionId)} />)}
    {calls.length > featuredCalls.length ? <Button quiet label={`View all ${calls.length} calls`} onPress={() => setShowAllCalls(true)} /> : showAllCalls && calls.length > 1 ? <Button quiet label="Show current calls" onPress={() => setShowAllCalls(false)} /> : null}

    <SectionTitle eyebrow="FIXTURE TIMELINE" title="What actually happened." />
    <Card>
      {timeline.length === 0 ? <Text style={styles.bodyMuted}>No match events yet.</Text> : visibleTimeline.map((event: Json, index: number) => (
        <View key={String(event.id ?? index)} style={styles.timelineRow}><Text style={styles.timelineMinute}>{event.minute != null ? `${event.minute}′` : "•"}</Text><View style={styles.timelineCopy}><Text style={styles.timelineType}>{String(event.type ?? event.kind ?? "event").replace(/[-_.]/g, " ").toUpperCase()}</Text><Text style={styles.body}>{event.label ?? event.description ?? event.player?.name ?? "Verified fixture event"}</Text></View></View>
      ))}
    </Card>
    {timeline.length > 3 ? <Button quiet label={showTimeline ? "Show latest events" : `View full timeline · ${timeline.length}`} onPress={() => setShowTimeline((open) => !open)} /> : null}
    {state.pressure ? <Card><View style={styles.pressureTop}><Text style={styles.cardEyebrow}>MATCH PRESSURE</Text><Text style={styles.pressureValue}>{Math.round(Number(state.pressure.value ?? 0) * 100)}%</Text></View><View style={styles.pressureTrack}><View style={[styles.pressureFill, { width: `${Math.round(Number(state.pressure.value ?? 0) * 100)}%` }]} /></View><Text style={styles.hint}>SIGNED INCIDENTS {Number(state.pressure.eventCount ?? 0)} · SIGNED ODDS {Number(state.pressure.oddsSnapshotCount ?? 0)}</Text></Card> : null}
    {(state.marketSays ?? []).map((item: Json) => <Card key={String(item.id)}><Text style={styles.cardEyebrow}>MARKET SAYS</Text><Text style={styles.cardTitle}>{item.text}</Text><Text style={styles.bodyMuted}>Verified odds movement · context, not betting advice.</Text></Card>)}
  </ScrollView>;
}

function CallCard({ view, disabled, attestationAvailable, onSelect }: { view: Json; disabled: boolean; attestationAvailable: boolean; onSelect(optionId: string): Promise<void> }) {
  const winning = view.settlement?.outcome?.status === "settled" ? view.settlement.outcome.winningOption : null;
  const selectable = view.status === "open" && !view.myAnswer && attestationAvailable && !disabled;
  return <Card strong={view.status === "settled"}>
    <View style={styles.callTop}><View style={styles.callCopy}><Text style={styles.pill}>{String(view.status).toUpperCase()}</Text><Text style={styles.callPrompt}>{view.call.prompt}</Text></View><Text style={styles.callTimer}>{view.status === "open" ? `${Math.max(0, Math.ceil((Number(view.call.locksAt) - Date.now()) / 1000))}s` : "◉"}</Text></View>
    {(view.call.options ?? []).map((option: Json) => {
      const total = Number(view.total || 0); const count = Number(view.tally?.[option.id] || 0); const share = total ? Math.round((count / total) * 100) : 0;
      const mine = view.myAnswer?.optionId === option.id; const won = winning === option.id;
      return <Pressable key={String(option.id)} disabled={!selectable} onPress={() => void onSelect(String(option.id))} style={[styles.option, (mine || won) && styles.optionActive]}>
        <View style={[styles.optionFill, { width: `${share}%` }]} /><Text style={styles.optionText}>{mine ? "● " : won ? "✓ " : ""}{option.label}</Text><Text style={styles.optionShare}>{share}%</Text>
      </Pressable>;
    })}
    {view.myAnswer ? <Text style={styles.receipt}>✓ SIGNED RECEIPT · {String(view.myAnswer.receiptState ?? "accepted").toUpperCase()}{view.points ? ` · +${view.points} IQ` : ""}</Text> : null}
    {view.status === "open" && !view.myAnswer ? <Text style={styles.hint}>{attestationAvailable ? "The signed feed lock is authoritative; this countdown is presentation only." : "Answer controls stay hidden until the manifest pins an attestor."}</Text> : null}
  </Card>;
}

function ChatTab({ roomId, items, state, closed, busy, onRun, request, onRefresh, refreshing }: { roomId: string; items: Json[]; state: Json; closed: boolean; busy: boolean; onRun(action: () => Promise<void>): Promise<void>; request: ReturnType<typeof usePeer>["request"]; onRefresh(): Promise<void>; refreshing: boolean }) {
  const [text, setText] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [pollMode, setPollMode] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollKind, setPollKind] = useState<"wager" | "poll">(mobileSlipConfiguration() ? "wager" : "poll");
  const [draftRulebook, setDraftRulebook] = useState<CompiledRulebook | null>(null);
  const [pendingMarket, setPendingMarket] = useState<PendingMobileMarket | null>(null);
  const [threadItem, setThreadItem] = useState<Json | null>(null);
  const pendingMarketKey = `fulltime.pending-market.${roomId}`;
  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(pendingMarketKey).then((stored) => {
      if (!alive || !stored) return;
      const pending = JSON.parse(stored) as PendingMobileMarket;
      const rulebook = deserializePendingRulebook(pending.rulebook);
      setPendingMarket(pending);
      setDraftRulebook(rulebook);
      setPollQuestion(pending.question);
      setPollKind("wager");
      setPollMode(true);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [pendingMarketKey]);
  const send = () => onRun(async () => { await request("room.message.send", { roomId, input: { text: text.trim() } }); setText(""); });
  const compileWager = () => onRun(async () => {
    const config = mobileSlipConfiguration();
    const fixture = state.fixture?.fixture;
    const fixtureId = String(fixture?.id ?? "");
    if (!config || !fixtureId || !fixture) throw new Error("This room does not expose a configured Slip compiler and fixture.");
    setDraftRulebook(await compileMobileRulebook({ config, fixtureId, question: pollQuestion, fixture: { competition: String(fixture.competition), home: String(fixture.home.name), away: String(fixture.away.name), kickoff: Number(fixture.kickoff), ...(Number.isSafeInteger(fixture.rawStatusCode) ? { gameState: Number(fixture.rawStatusCode) } : {}) } }));
  });
  const createPoll = () => onRun(async () => {
    const options = pollKind === "wager" && draftRulebook ? draftRulebook.outcomeLabels : pollOptions.map((value) => value.trim()).filter(Boolean);
    if (pollKind === "wager") {
      const config = mobileSlipConfiguration();
      if (!config || !draftRulebook) throw new Error("Build and review the Rulebook before publishing the wager.");
      let pending = pendingMarket;
      if (!pending) {
        const created = await request<Json>("room.poll.create", { roomId, input: { question: pollQuestion.trim(), options } });
        pending = { pollId: String(created.poll.id), question: pollQuestion.trim(), rulebook: serializePendingRulebook(draftRulebook) };
        await SecureStore.setItemAsync(pendingMarketKey, JSON.stringify(pending), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        setPendingMarket(pending);
      }
      const wallet = await loadMobileSlipWallet(config);
      const reference = pending.reference ?? await createMobileMarketReference({ config, wallet, rulebook: draftRulebook });
      if (!pending.reference) {
        pending = { ...pending, reference };
        await SecureStore.setItemAsync(pendingMarketKey, JSON.stringify(pending), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        setPendingMarket(pending);
      }
      const { version: _version, ...durableReference } = reference;
      await request("room.market.reference", { roomId, input: { pollId: pending.pollId, ...durableReference } });
      await SecureStore.deleteItemAsync(pendingMarketKey);
      setPendingMarket(null);
    } else await request("room.poll.create", { roomId, input: { question: pollQuestion.trim(), options } });
    setPollQuestion(""); setPollOptions(["", ""]); setDraftRulebook(null); setPollMode(false);
  });
  return <View style={styles.flex}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.chatContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}>
      {items.length === 0 ? <Empty text="No messages yet. Set the tone." /> : items.map((item) => <FeedItem key={String(item.id)} item={item} onThread={() => setThreadItem(item)} onDownload={() => onRun(() => downloadAndShareAttachment(request, roomId, String(item.id)))} onReact={(emoji) => onRun(async () => { await request("room.item.react", { roomId, itemId: String(item.id), emoji }); })} onVote={(option) => onRun(async () => { await request("room.poll.vote", { roomId, pollId: String(item.poll.id), option }); })} />)}
      {(state.typingUsers ?? []).length ? <Text style={styles.typing}>{state.typingUsers.map((member: Json) => member.displayName).join(", ")} typing…</Text> : null}
    </ScrollView>
    {!closed ? <View style={styles.composer}>
      {pollMode ? <View style={styles.pollComposer}><View style={styles.pollComposerTop}><Text style={styles.cardEyebrow}>{pendingMarket ? "FINISH SIGNED MARKET" : pollKind === "wager" ? "NATURAL WAGER" : "NEW ROOM POLL"}</Text><Pressable onPress={() => setPollMode(false)}><Text style={styles.smallAction}>CLOSE</Text></Pressable></View>{mobileSlipConfiguration() ? <View style={styles.pollKindTabs}><Pressable disabled={Boolean(pendingMarket)} accessibilityRole="tab" accessibilityState={{ selected: pollKind === "wager", disabled: Boolean(pendingMarket) }} onPress={() => { setPollKind("wager"); setDraftRulebook(null); }} style={[styles.pollKindTab, pollKind === "wager" && styles.pollKindTabActive]}><Text style={[styles.pollKindTabText, pollKind === "wager" && styles.pollKindTabTextActive]}>WAGER</Text></Pressable><Pressable disabled={Boolean(pendingMarket)} accessibilityRole="tab" accessibilityState={{ selected: pollKind === "poll", disabled: Boolean(pendingMarket) }} onPress={() => { setPollKind("poll"); setDraftRulebook(null); }} style={[styles.pollKindTab, pollKind === "poll" && styles.pollKindTabActive]}><Text style={[styles.pollKindTabText, pollKind === "poll" && styles.pollKindTabTextActive]}>POLL</Text></Pressable></View> : null}<Field value={pollQuestion} onChangeText={(value) => { if (!pendingMarket) { setPollQuestion(value); setDraftRulebook(null); } }} placeholder={pollKind === "wager" ? "Will both teams score? Yes or no." : "Ask the room…"} />{pollKind === "poll" ? <>{pollOptions.map((option, index) => <Field key={index} value={option} onChangeText={(value) => setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder={`Option ${index + 1}`} maxLength={80} />)}{pollOptions.length < 5 ? <Pressable onPress={() => setPollOptions((current) => [...current, ""])}><Text style={styles.smallAction}>+ ADD OPTION</Text></Pressable> : null}</> : draftRulebook ? <View style={styles.rulebookPreview}><Text style={styles.cardEyebrow}>VERIFIED RULEBOOK</Text><Text style={styles.body}>{draftRulebook.sentence}</Text><Text style={styles.hint}>{draftRulebook.outcomeLabels.join("  ·  ")}</Text>{pendingMarket ? <Text style={styles.hint}>THE ROOM POLL IS SAVED. RETRY TO FINISH ITS SOLANA REGISTRATION.</Text> : null}</View> : <Text style={styles.hint}>FULLTIME DERIVES COMPLETE OUTCOMES, THEN SHOWS THE EXACT TERMS BEFORE SIGNING.</Text>}<Button label={pollKind === "wager" ? pendingMarket ? "Finish publishing market" : draftRulebook ? "Publish signed market" : "Build Rulebook" : "Post poll"} disabled={busy || !pollQuestion.trim() || (pollKind === "poll" && pollOptions.filter((value) => value.trim()).length < 2)} onPress={pollKind === "wager" && !draftRulebook ? compileWager : createPoll} /></View> : <>{actionsOpen ? <View style={styles.composerActions}><Pressable disabled={busy} style={styles.composerAction} onPress={() => { setActionsOpen(false); void onRun(async () => { await pickAndUploadAttachment(request, roomId, text); setText(""); }); }}><Text style={styles.composerActionTitle}>Attach a file</Text><Text style={styles.hint}>Encrypted before it enters room history</Text></Pressable><Pressable style={styles.composerAction} onPress={() => { setActionsOpen(false); setPollMode(true); }}><Text style={styles.composerActionTitle}>Create a wager or poll</Text><Text style={styles.hint}>Natural language becomes a verified Slip Rulebook</Text></Pressable></View> : null}<View style={styles.composerRow}><Pressable style={styles.plusButton} onPress={() => setActionsOpen((open) => !open)}><Text style={styles.plus}>{actionsOpen ? "×" : "+"}</Text></Pressable><TextInput style={styles.composerInput} value={text} onChangeText={setText} placeholder="Say it to the room…" placeholderTextColor={colors.smoke} multiline maxLength={4000} /><Pressable disabled={!text.trim() || busy} onPress={() => void send()} style={[styles.sendButton, (!text.trim() || busy) && styles.disabled]}><Text style={styles.sendText}>↑</Text></Pressable></View></>}
    </View> : <Banner text="THIS ROOM IS CLOSED · HISTORY IS READ-ONLY" />}
    {threadItem ? <ThreadOverlay roomId={roomId} item={threadItem} closed={closed} request={request} onRun={onRun} onClose={() => setThreadItem(null)} /> : null}
  </View>;
}

function FeedItem({ item, onReact, onVote, onThread, onDownload }: { item: Json; onReact(emoji: string): Promise<void>; onVote(option: string): Promise<void>; onThread?(): void; onDownload?(): Promise<void> }) {
  if (item.kind === "system") return <View style={styles.systemMessage}><Text style={styles.systemText}>{item.text}</Text></View>;
  if (item.kind === "poll") {
    const pollOptions = (item.poll.options ?? []) as Array<Json | string>;
    const total = pollOptions.reduce((sum, option) => sum + (typeof option === "string" ? 0 : Number(option.votes ?? 0)), 0);
    return <Card><Text style={styles.cardEyebrow}>ROOM POLL</Text><Text style={styles.pollQuestion}>{item.poll.question}</Text>{pollOptions.map((option) => {
    const id = typeof option === "string" ? option : String(option.id); const label = typeof option === "string" ? option : option.label;
    const count = typeof option === "string" ? 0 : Number(option.votes ?? 0); const share = total ? Math.round((count / total) * 100) : 0;
    return <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: item.myVote === id }} onPress={() => void onVote(id)} style={[styles.pollOption, item.myVote === id && styles.pollOptionActive]}><View style={[styles.pollOptionFill, { width: `${share}%` }]} /><Text style={styles.pollOptionText}>{label}</Text><Text style={styles.pollOptionShare}>{share}%{item.myVote === id ? "  ✓" : ""}</Text></Pressable>;
  })}{item.poll.marketReference ? <MobileWager poll={item.poll} /> : null}</Card>;
  }
  const mine = Boolean(item.author?.isCurrentUser);
  const name = String(item.author?.displayName ?? "Room member");
  const authorId = item.author?.userId != null ? String(item.author.userId) : undefined;
  return <View style={[styles.messageRow, mine && styles.messageRowMine]}>
    <PeerAvatar userId={authorId} displayName={name} size="md" isCurrentUser={mine} />
    <View style={[styles.messageColumn, mine && styles.messageColumnMine]}>
      <View style={[styles.messageTop, mine && styles.messageTopMine]}>
        <Text style={styles.messageAuthor}>{name}{item.author?.role === "creator" ? " · CREATOR" : item.author?.role === "moderator" ? " · MOD" : ""}</Text>
        <Text style={styles.messageTime}>{new Date(Number(item.createdAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
      </View>
      <View style={[styles.message, mine && styles.messageMine]}>
        {item.text ? <Text style={styles.messageText}>{item.text}</Text> : null}
        {item.text ? <MobileLinkPreviews text={String(item.text)} /> : null}
        {item.attachment ? <Pressable onPress={() => void onDownload?.()} style={styles.attachment}><Text style={styles.attachmentName}>▣ {item.attachment.name}</Text><Text style={styles.bodyMuted}>{item.attachment.mimeType} · {formatBytes(Number(item.attachment.sizeBytes))}</Text><Text style={styles.attachmentAction}>OPEN VERIFIED COPY</Text></Pressable> : null}
      </View>
      <View style={[styles.reactions, mine && styles.reactionsMine]}>
        {QUICK_REACTIONS.map((emoji) => <Pressable key={emoji} onPress={() => void onReact(emoji)} style={styles.reaction}><Text>{emoji}</Text></Pressable>)}
        {(item.reactions ?? []).filter((reaction: Json) => reaction.count).map((reaction: Json) => <Text key={reaction.emoji} style={styles.reactionCount}>{reaction.emoji} {reaction.count}</Text>)}
        {onThread ? <Pressable onPress={onThread} style={styles.threadAction}><Text style={styles.threadActionText}>↳ {Number(item.replyCount ?? 0)} REPLIES</Text></Pressable> : null}
      </View>
    </View>
  </View>;
}

function MobileLinkPreviews({ text }: { text: string }) {
  const endpoint = Constants.expoConfig?.extra?.linkPreviewUrl;
  const links = useMemo(() => externalLinks(text), [text]);
  if (typeof endpoint !== "string" || !links.length) return null;
  return <View style={styles.linkPreviewList}>{links.map((url) => <MobileLinkPreviewCard key={url} endpoint={endpoint} url={url} />)}</View>;
}

function MobileLinkPreviewCard({ endpoint, url }: { endpoint: string; url: string }) {
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<MobileLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError(null);
    fetchMobileLinkPreview(endpoint, url, controller.signal).then(setPreview).catch((reason) => {
      if (!controller.signal.aborted) setError(message(reason));
    });
    return () => controller.abort();
  }, [endpoint, revision, url]);
  if (!preview && !error) return <View accessibilityLabel="Loading link preview" style={styles.linkPreviewLoading}><ActivityIndicator size="small" color={colors.blue} /><Text style={styles.hint}>LOADING PREVIEW</Text></View>;
  if (error) return <Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)} style={styles.linkPreviewFallback}><Text style={styles.linkPreviewSite}>PREVIEW UNAVAILABLE</Text><Text numberOfLines={1} style={styles.linkPreviewTitle}>{new URL(url).hostname}</Text><Text style={styles.smallAction}>RETRY</Text></Pressable>;
  if (!preview) return null;
  if (preview.kind === "x") {
    return <Pressable accessibilityRole="link" accessibilityLabel={`Open X post by ${preview.authorName}`} onPress={() => void Linking.openURL(preview.url)} style={styles.xEmbed}><View style={styles.xEmbedHeader}><View style={styles.xMark}><Text style={styles.xMarkText}>X</Text></View><View style={styles.flex}><Text style={styles.xAuthor}>{preview.authorName}</Text><Text style={styles.xHandle}>@{preview.authorName}</Text></View><Text style={styles.smallAction}>OPEN</Text></View><Text style={styles.xPostText}>{preview.text}</Text><Text style={styles.xSource}>PRELOADED FROM X</Text></Pressable>;
  }
  return <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(preview.url)} style={styles.linkPreview}><Text style={styles.linkPreviewSite}>{preview.siteName.toUpperCase()}</Text><Text numberOfLines={2} style={styles.linkPreviewTitle}>{preview.title}</Text>{preview.description ? <Text numberOfLines={2} style={styles.linkPreviewDescription}>{preview.description}</Text> : null}<Text style={styles.smallAction}>OPEN LINK</Text></Pressable>;
}

function mobileSlipConfiguration(): MobileSlipConfiguration | null {
  const value = Constants.expoConfig?.extra?.slip as Partial<MobileSlipConfiguration> | null | undefined;
  if (!value || value.network !== "localnet" || typeof value.rpcUrl !== "string" || typeof value.fundingUrl !== "string" || typeof value.compilerUrl !== "string" || typeof value.program !== "string" || typeof value.mint !== "string") return null;
  return value as MobileSlipConfiguration;
}

function MobileWager({ poll }: { poll: Json }) {
  const config = useMemo(mobileSlipConfiguration, []);
  const reference = poll.marketReference as MarketReferenceV1;
  const [verification, setVerification] = useState<"checking" | "verified" | "error">("checking");
  const [verificationRevision, setVerificationRevision] = useState(0);
  const [showVerificationError, setShowVerificationError] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"outcome" | "stake">("outcome");
  const [outcome, setOutcome] = useState<number | null>(null);
  const [preset, setPreset] = useState("10");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ outcome: number; amount: bigint; signature: string } | null>(null);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [tickets, setTickets] = useState<TicketSnapshot[]>([]);
  const [wallet, setWallet] = useState<MobileSlipWallet | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);
  useEffect(() => {
    if (!config) return;
    let alive = true;
    setVerification("checking");
    setError(null);
    verifyMobileMarketReference(config, reference)
      .then(() => { if (alive) { setVerification("verified"); setShowVerificationError(false); } })
      .catch((reason) => { if (alive) { setError(message(reason)); setVerification("error"); } });
    return () => { alive = false; };
  }, [config, reference.creationSignature, reference.market, verificationRevision]);
  if (!config) return null;
  if (verification === "checking") return <View accessibilityLabel="Verifying Slip market" style={styles.marketVerification}><ActivityIndicator color={colors.ink} size="small" /></View>;
  if (verification === "error") return <View style={styles.marketVerificationError}>
    <Pressable accessibilityRole="button" accessibilityLabel="Market verification details" onPress={() => setShowVerificationError((shown) => !shown)} style={styles.marketInfoButton}><Text style={styles.marketInfoText}>i</Text></Pressable>
    {showVerificationError ? <View style={styles.marketErrorCopy}><Text style={styles.hint}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setVerificationRevision((value) => value + 1)} style={styles.marketRetry}><Text style={styles.smallAction}>RETRY</Text></Pressable></View> : null}
  </View>;
  const amountText = custom.trim() || preset;
  let amount: bigint | null = null;
  try { const parsed = parseAmount(amountText); amount = parsed >= 1_000_000n ? parsed : null; } catch { amount = null; }
  const options = (poll.options ?? []) as Json[];
  const refreshMarket = async () => {
    if (!config) return null;
    setLoadingMarket(true);
    try {
      const position = await getMobileMarketPosition({ config, reference });
      setMarket(position.market);
      setTickets(position.tickets);
      setWallet(position.wallet);
      return position;
    } finally {
      setLoadingMarket(false);
    }
  };
  const showWager = async () => {
    setError(null);
    setOpen(true);
    try {
      const position = await refreshMarket();
      if (position?.market.status === "open") setStep("outcome");
    } catch (reason) { setError(message(reason)); }
  };
  const sign = async () => {
    if (outcome === null || amount === null) return;
    setBusy(true); setError(null);
    try {
      const wallet = await loadMobileSlipWallet(config);
      const result = await buyMobileTicket({ config, wallet, reference, outcomeIndex: outcome, amount });
      setReceipt({ outcome, amount, signature: result.signature });
      await refreshMarket();
      setOpen(false);
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const claim = async (ticket: TicketSnapshot) => {
    if (!wallet || !market || (market.status !== "resolved" && market.status !== "voided")) return;
    setBusy(true); setError(null);
    try {
      await claimMobileTicket({ config, reference, wallet, ticket, refund: market.status === "voided" });
      await refreshMarket();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const terminal = market?.status === "resolved" || market?.status === "voided";
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={terminal ? "View result" : receipt ? `Backed ${formatAmount(receipt.amount)} USDT on ${options[receipt.outcome]?.label}` : "Back my stand"} onPress={() => void showWager()} style={styles.wagerCta}><Text style={styles.wagerCtaText}>{terminal ? "VIEW RESULT" : receipt ? `✓ ${options[receipt.outcome]?.label} · ${formatAmount(receipt.amount)} USDT` : "◉  BACK MY STAND"}</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.wagerBackdrop}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wagerSheet}>
      <View style={styles.wagerHeader}><View style={styles.flex}><Text style={styles.cardEyebrow}>{terminal ? "SETTLED" : step === "outcome" ? "CHOOSE YOUR STAND" : "SET YOUR STAKE"}</Text><Text style={styles.wagerQuestion}>{poll.question}</Text></View><Pressable accessibilityLabel="Close wager" onPress={() => setOpen(false)} style={styles.threadClose}><Text style={styles.threadCloseText}>×</Text></Pressable></View>
      {loadingMarket ? <ActivityIndicator color={colors.ink} /> : terminal && market ? <View style={styles.wagerChoices}><Text style={styles.cardTitle}>{market.status === "voided" ? "Market refunded" : `${market.outcomeLabels[market.winningOutcome ?? 0]} won`}</Text>{tickets.length ? tickets.map((ticket) => { const eligible = !ticket.claimed && (market.status === "voided" || ticket.outcomeIndex === market.winningOutcome); return <View key={ticket.address} style={styles.wagerSelection}><View><Text style={styles.pollOptionText}>{market.outcomeLabels[ticket.outcomeIndex]} · {formatAmount(ticket.stake)} USDT</Text><Text style={styles.hint}>{ticket.claimed ? "Claimed" : eligible ? "Ready to claim" : "This stand did not win"}</Text></View>{eligible ? <Pressable disabled={busy} onPress={() => void claim(ticket)}><Text style={styles.smallAction}>{busy ? "SIGNING…" : market.status === "voided" ? "REFUND" : "CLAIM"}</Text></Pressable> : null}</View>; }) : <Text style={styles.hint}>No ticket from this device wallet.</Text>}{error ? <ErrorText text={error} /> : null}</View> : step === "outcome" ? <View style={styles.wagerChoices}>{options.map((option, index) => <Pressable key={String(option.id)} accessibilityRole="button" accessibilityState={{ selected: outcome === index }} onPress={() => setOutcome(index)} style={[styles.wagerChoice, outcome === index && styles.wagerChoiceActive]}><Text style={[styles.wagerChoiceText, outcome === index && styles.wagerChoiceTextActive]}>{option.label}</Text>{outcome === index ? <Text style={styles.wagerChoiceTextActive}>✓</Text> : null}</Pressable>)}<Button label={outcome === null ? "Choose your stand" : "Continue"} disabled={outcome === null} onPress={() => setStep("stake")} /></View> : <View style={styles.wagerChoices}><Pressable onPress={() => setStep("outcome")} style={styles.wagerSelection}><Text style={styles.pollOptionText}>{outcome === null ? "—" : options[outcome]?.label}</Text><Text style={styles.smallAction}>CHANGE</Text></Pressable><View style={styles.stakePresets}>{["5", "10", "25"].map((value) => <Pressable key={value} onPress={() => { setPreset(value); setCustom(""); }} style={[styles.stakePreset, !custom && preset === value && styles.wagerChoiceActive]}><Text style={[styles.pollOptionText, !custom && preset === value && styles.wagerChoiceTextActive]}>{value}</Text></Pressable>)}</View><Field value={custom} onChangeText={setCustom} placeholder="Custom USDT" keyboardType="decimal-pad" /><Button label={busy ? "Signing real stake…" : amount ? `Sign ${formatAmount(amount)} USDT` : "Enter at least 1 USDT"} disabled={busy || amount === null} onPress={() => void sign()} />{error ? <ErrorText text={error} /> : null}<Text style={styles.hint}>This device signs the Slip escrow transaction with its locally stored Solana key.</Text></View>}
    </KeyboardAvoidingView></SafeAreaView></Modal>
  </>;
}

function ThreadOverlay({ roomId, item, closed, request, onRun, onClose }: { roomId: string; item: Json; closed: boolean; request: ReturnType<typeof usePeer>["request"]; onRun(action: () => Promise<void>): Promise<void>; onClose(): void }) {
  const [replies, setReplies] = useState<Json[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setLoading(true); const page = await request<Json>("room.thread.page", { roomId, itemId: String(item.id), limit: 100 }); setReplies(chronologicalPage(page.items)); setError(null); } catch (reason) { setError(message(reason)); } finally { setLoading(false); } }, [item.id, request, roomId]);
  useEffect(() => { void load(); }, [load]);
  const send = () => onRun(async () => { await request("room.reply.send", { roomId, itemId: String(item.id), input: { text: text.trim() } }); setText(""); await load(); });
  return <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={styles.safe}><View style={styles.threadHeader}><View><Text style={styles.eyebrow}>THREAD</Text><Text style={styles.cardTitle}>{replies.length} {replies.length === 1 ? "reply" : "replies"}</Text></View><Pressable onPress={onClose} style={styles.threadClose}><Text style={styles.threadCloseText}>×</Text></Pressable></View><ScrollView style={styles.flex} contentContainerStyle={styles.chatContent}><FeedItem item={item} onReact={async () => undefined} onVote={async () => undefined} />{loading ? <ActivityIndicator /> : null}{error ? <ErrorText text={error} /> : null}{replies.map((reply) => {
    const replyName = String(reply.author?.displayName ?? "Room member");
    const replyId = reply.author?.userId != null ? String(reply.author.userId) : undefined;
    return <View key={String(reply.id)} style={styles.messageRow}>
      <PeerAvatar userId={replyId} displayName={replyName} size="sm" isCurrentUser={Boolean(reply.author?.isCurrentUser)} />
      <View style={styles.messageColumn}>
        <View style={styles.messageTop}><Text style={styles.messageAuthor}>{replyName}</Text><Text style={styles.messageTime}>{new Date(Number(reply.createdAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View>
        <View style={styles.message}><Text style={styles.messageText}>{reply.text}</Text></View>
      </View>
    </View>;
  })}</ScrollView>{!closed ? <View style={styles.composerRow}><TextInput style={styles.composerInput} value={text} onChangeText={setText} placeholder="Reply…" placeholderTextColor={colors.smoke} multiline maxLength={4000} /><Pressable disabled={!text.trim()} onPress={() => void send()} style={[styles.sendButton, !text.trim() && styles.disabled]}><Text style={styles.sendText}>↑</Text></Pressable></View> : null}</SafeAreaView></Modal>;
}

function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`; }

function PollTab({ roomId, items, busy, onRun, request, onRefresh, refreshing }: { roomId: string; items: Json[]; busy: boolean; onRun(action: () => Promise<void>): Promise<void>; request: ReturnType<typeof usePeer>["request"]; onRefresh(): Promise<void>; refreshing: boolean }) {
  return <ScrollView style={styles.flex} contentContainerStyle={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}>
    <SectionTitle eyebrow="ROOM POLLS" title="What does the room think?" />
    {items.length === 0 ? <Empty text="Create a poll from the chat composer." /> : items.map((item) => <FeedItem key={String(item.id)} item={item} onReact={async () => undefined} onVote={(option) => onRun(async () => { if (!busy) await request("room.poll.vote", { roomId, pollId: String(item.poll.id), option }); })} />)}
  </ScrollView>;
}

function DetailsTab({ roomId, details, busy, onRun, request, onBack, onSession, onRefresh, refreshing }: { roomId: string; details: Json; busy: boolean; onRun(action: () => Promise<void>): Promise<void>; request: ReturnType<typeof usePeer>["request"]; onBack(): void; onSession(value: Json | null): void; onRefresh(): Promise<void>; refreshing: boolean }) {
  const [rename, setRename] = useState("");
  const [slow, setSlow] = useState(String(details.slowModeSeconds ?? 0));
  const [reportMember, setReportMember] = useState<Json | null>(null);
  const [reportReason, setReportReason] = useState("harassment");
  const [reportNote, setReportNote] = useState("");
  const [reports, setReports] = useState<Json[] | null>(null);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const invite = details.invite;
  const shareInvite = async () => {
    if (!invite?.code) return;
    await Share.share({ title: details.room.name, message: `Join my encrypted FullTime room:\n${invite.code}` });
  };
  return <ScrollView style={styles.flex} contentContainerStyle={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}>
    <Card><Text style={styles.cardEyebrow}>🔒 ENCRYPTED INVITE-ONLY ROOM</Text><Text style={styles.detailsTitle}>{details.room.name}</Text><Text style={styles.bodyMuted}>{details.fixture.competition} · {details.fixture.home.name} vs {details.fixture.away.name}</Text><View style={styles.stats}><Stat label="MEMBERS" value={details.members.length} /><Stat label="SLOW MODE" value={details.slowModeSeconds ? `${details.slowModeSeconds}s` : "OFF"} /><Stat label="INVITE JOINS" value={details.influence?.successfulJoins ?? 0} /></View></Card>
    {invite?.status === "active" && !details.isClosed ? <Card><Text style={styles.cardEyebrow}>ACTIVE INVITE</Text><Text style={styles.cardTitle}>Bring your people.</Text><Text style={styles.bodyMuted}>{invite.viewerSuccessfulJoins ?? 0} successful joins through your invite.</Text><Button label="Share invite" onPress={() => void shareInvite()} /></Card> : null}
    {!invite && details.permissions.canInvite ? <Button label="Create invite" disabled={busy} onPress={() => void onRun(async () => { await request("room.invite.create", { roomId }); })} /> : null}
    <SectionTitle eyebrow="MEMBERS" title={`${details.members.length} in the room`} />
    <Card>{details.members.map((member: Json) => <View key={String(member.userId)} style={styles.memberRow}><PeerAvatar userId={String(member.userId)} displayName={String(member.displayName)} size="md" isCurrentUser={Boolean(member.isCurrentUser)} style={styles.memberAvatar} /><View style={styles.memberCopy}><Text style={styles.memberName}>{member.displayName}{member.isCurrentUser ? " · you" : ""}</Text><Text style={styles.memberRole}>{String(member.role).toUpperCase()}</Text></View>{!member.isCurrentUser ? <View style={styles.memberActions}><Pressable onPress={() => setReportMember(member)}><Text style={styles.smallAction}>REPORT</Text></Pressable>{details.permissions.canModerateMembers ? <><Pressable onPress={() => void onRun(async () => { await request("room.member.role", { roomId, userId: String(member.userId), role: member.role === "moderator" ? "member" : "moderator" }); await onRefresh(); })}><Text style={styles.smallAction}>{member.role === "moderator" ? "DEMOTE" : "MOD"}</Text></Pressable><Pressable onPress={() => Alert.alert("Remove member?", `${member.displayName} will lose room access.`, [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => void onRun(async () => { await request("room.member.remove", { roomId, userId: String(member.userId) }); await onRefresh(); }) }])}><Text style={[styles.smallAction, styles.dangerText]}>REMOVE</Text></Pressable></> : null}</View> : <View style={[styles.presence, member.isOnline && styles.presenceOnline]} />}</View>)}</Card>
    {reportMember ? <Card><Text style={styles.cardEyebrow}>REPORT {String(reportMember.displayName).toUpperCase()}</Text><View style={styles.reasonGrid}>{["harassment", "hate", "misinformation", "sexual-content", "spam", "threats", "other"].map((reason) => <Pressable key={reason} onPress={() => setReportReason(reason)} style={[styles.reason, reportReason === reason && styles.reasonActive]}><Text style={styles.reasonText}>{reason.replace("-", " ").toUpperCase()}</Text></Pressable>)}</View><Field value={reportNote} onChangeText={setReportNote} placeholder="Optional context for room moderators" multiline maxLength={1000} /><View style={styles.inline}><Button quiet label="Cancel" onPress={() => setReportMember(null)} /><Button label="Submit report" disabled={busy} onPress={() => void onRun(async () => { await request("room.report", { roomId, target: { kind: "member", id: String(reportMember.userId) }, reason: reportReason, note: reportNote.trim() }); setReportMember(null); setReportNote(""); })} /></View></Card> : null}
    {details.permissions.canModerateMembers ? <><DisclosureButton label="Moderation inbox" meta={reports ? `${reports.length} reports` : "Private reports"} open={moderationOpen} onPress={() => setModerationOpen((open) => !open)} />{moderationOpen ? <><Button quiet label={reports ? "Refresh reports" : "Load reports"} disabled={busy} onPress={() => void onRun(async () => setReports(await request<Json[]>("room.reports.list", { roomId })))} />{reports?.length === 0 ? <Empty text="No reports in this room." /> : reports?.map((report) => <Card key={String(report.reportId)}><Text style={styles.cardEyebrow}>{String(report.reason).replace("-", " ").toUpperCase()}</Text><Text style={styles.body}>Target: {report.target?.kind} · {report.target?.id}</Text>{report.note ? <Text style={styles.bodyMuted}>{report.note}</Text> : null}<Text style={styles.messageTime}>{new Date(Number(report.createdAt)).toLocaleString()}</Text></Card>)}</> : null}</> : null}
    {details.permissions.canRename || details.permissions.canSetSlowMode ? <><DisclosureButton label="Creator controls" meta="Name and slow mode" open={controlsOpen} onPress={() => setControlsOpen((open) => !open)} />{controlsOpen ? <Card>{details.permissions.canRename ? <><Field value={rename} onChangeText={setRename} placeholder={details.room.name} maxLength={48} /><Button quiet label="Rename room" disabled={busy || !rename.trim()} onPress={() => void onRun(async () => { await request("room.rename", { roomId, name: rename.trim() }); setRename(""); })} /></> : null}{details.permissions.canSetSlowMode ? <><Field value={slow} onChangeText={setSlow} placeholder="Slow mode seconds (0–60)" keyboardType="number-pad" /><Button quiet label="Apply slow mode" disabled={busy || !/^\d+$/.test(slow) || Number(slow) > 60} onPress={() => void onRun(async () => { await request("room.slow-mode", { roomId, seconds: Number(slow) }); })} /></> : null}</Card> : null}</> : null}
    <DisclosureButton label="Room and account" meta="Invite and exit controls" open={dangerOpen} danger onPress={() => setDangerOpen((open) => !open)} />
    {dangerOpen ? <Card>{details.permissions.canRegenerateInvite ? <Button quiet label="Regenerate invite" disabled={busy} onPress={() => Alert.alert("Regenerate invite?", "The current invite stops admitting new members.", [{ text: "Cancel", style: "cancel" }, { text: "Regenerate", style: "destructive", onPress: () => void onRun(async () => { await request("room.invite.regenerate", { roomId }); }) }])} /> : null}{invite && details.permissions.canRevokeInvite ? <Button quiet label="Revoke invite" disabled={busy} onPress={() => Alert.alert("Revoke invite?", "The current invite stops admitting new members.", [{ text: "Cancel", style: "cancel" }, { text: "Revoke", style: "destructive", onPress: () => void onRun(async () => { await request("room.invite.revoke", { roomId }); await onRefresh(); }) }])} /> : null}{details.permissions.canCloseRoom ? <Button quiet label="Close room" disabled={busy || details.isClosed} onPress={() => Alert.alert("Close room?", "The durable history remains, but the room becomes read-only.", [{ text: "Cancel", style: "cancel" }, { text: "Close", style: "destructive", onPress: () => void onRun(async () => { await request("room.close", { roomId }); }) }])} /> : null}<Button quiet label="Leave room" disabled={busy} onPress={() => Alert.alert("Leave room?", "You will need a new active invite to rejoin.", [{ text: "Cancel", style: "cancel" }, { text: "Leave", style: "destructive", onPress: () => void onRun(async () => { await request("room.leave", { roomId }); onBack(); }) }])} /><Button quiet label="Sign out on this iPhone" disabled={busy} onPress={() => void onRun(async () => { await request("session.sign-out", null); onSession(null); onBack(); })} /></Card> : null}
  </ScrollView>;
}

function RoomRow({ room, onPress }: { room: Json; onPress(): void }) { return <Pressable onPress={onPress} style={styles.roomRow}><View style={styles.roomRowMain}><Text style={styles.roomRowName}>🔒 {room.room.name}</Text><Text style={styles.bodyMuted}>{room.fixture.home.name} vs {room.fixture.away.name}</Text></View><Text style={styles.chevron}>›</Text></Pressable>; }
function FixtureCard({ card, selected, onPress }: { card: Json; selected: boolean; onPress(): void }) { const fixture = card.fixture; return <Pressable onPress={onPress} style={[styles.fixtureCard, selected && styles.fixtureSelected]}><View style={styles.fixtureTop}><Text style={styles.cardEyebrow}>{fixture.competition}</Text><Text style={[styles.fixtureStatus, card.phase === "live" && styles.live]}>{card.phase === "live" ? `● LIVE ${card.minute ?? ""}′` : String(card.status).replace(/-/g, " ").toUpperCase()}</Text></View><View style={styles.fixtureTeamsRow}><CountryFlag country={fixture.home.country} teamName={fixture.home.name} size={24} /><Text style={styles.fixtureTeams}>{fixture.home.name}</Text><Text style={styles.bodyMuted}>vs</Text><CountryFlag country={fixture.away.country} teamName={fixture.away.name} size={24} /><Text style={styles.fixtureTeams}>{fixture.away.name}</Text></View><Text style={styles.fixtureScore}>{card.score ? `${card.score.home} — ${card.score.away}` : new Date(Number(fixture.kickoff)).toLocaleString()}</Text></Pressable>; }
function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) { return <View style={styles.sectionTitle}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.subheading}>{title}</Text></View>; }
function Card({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) { return <View style={[styles.card, strong && styles.cardStrong]}>{children}</View>; }
function Button({ label, onPress, disabled = false, quiet = false }: { label: string; onPress(): void; disabled?: boolean; quiet?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, quiet && styles.buttonQuiet, disabled && styles.disabled]}><Text style={[styles.buttonText, quiet && styles.buttonQuietText]}>{label}</Text></Pressable>; }
function Field(props: React.ComponentProps<typeof TextInput>) { return <TextInput placeholderTextColor={colors.smoke} {...props} style={[styles.field, props.multiline && styles.fieldMultiline, props.style]} />; }
function Banner({ text }: { text: string }) { return <View style={styles.banner}><Text style={styles.bannerText}>{text}</Text></View>; }
function ErrorText({ text, compact = false }: { text: string; compact?: boolean }) { return <View style={[styles.error, compact && styles.errorCompact]}><Text style={styles.errorText}>{text}</Text></View>; }
function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.bodyMuted}>{text}</Text></View>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function DisclosureButton({ label, meta, open, danger = false, onPress }: { label: string; meta: string; open: boolean; danger?: boolean; onPress(): void }) { return <Pressable onPress={onPress} style={[styles.disclosure, danger && styles.disclosureDanger]}><View style={styles.flex}><Text style={[styles.disclosureLabel, danger && styles.dangerText]}>{label}</Text><Text style={styles.hint}>{meta}</Text></View><Text style={[styles.disclosureMark, danger && styles.dangerText]}>{open ? "×" : "+"}</Text></Pressable>; }

const colors = { parchment: "#F4F0E9", white: "#FBFAF7", ink: "#232221", graphite: "#555250", smoke: "#807C78", ash: "#D0CBC4", mist: "#DDE4FF", blue: "#3457D5", crimson: "#B62931", gold: "#D29B36", green: "#2A7656" };
const mono = Platform.select({ ios: "Menlo", android: "monospace" });
const serif = Platform.select({ ios: "New York", android: "serif" });
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.parchment }, flex: { flex: 1 }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }, spinner: { marginTop: 28 }, centerCopy: { marginTop: 20, maxWidth: 540, textAlign: "center", color: colors.graphite, fontFamily: mono, fontSize: 14, lineHeight: 21 },
  onboarding: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 18 }, home: { padding: 20, paddingBottom: 60, gap: 14 }, focusFlow: { padding: 20, paddingBottom: 60, gap: 16 }, flowHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }, flowBack: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, borderWidth: 1, borderColor: colors.ash }, flowBackText: { color: colors.ink, fontSize: 28, lineHeight: 30 }, homeActions: { gap: 10, marginTop: 10 }, homeActionPrimary: { minHeight: 118, borderRadius: 20, backgroundColor: colors.ink, padding: 18, justifyContent: "center" }, homeAction: { minHeight: 104, borderRadius: 20, borderWidth: 1, borderColor: colors.ash, backgroundColor: "rgba(251,250,247,0.62)", padding: 18, justifyContent: "center" }, homeActionEyebrow: { color: colors.smoke, fontFamily: mono, fontSize: 8, letterSpacing: 1.2 }, homeActionTitle: { color: colors.ink, fontFamily: serif, fontSize: 25, marginTop: 4 }, homeActionArrow: { position: "absolute", right: 18, bottom: 16, color: colors.blue, fontSize: 20 }, homeActionLight: { color: colors.white }, topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }, headerActions: { flexDirection: "row", alignItems: "center", gap: 5 }, settingsButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.ash, alignItems: "center", justifyContent: "center" }, settingsGlyph: { color: colors.ink, fontSize: 17 }, settingsHeader: { minHeight: 86, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.ash }, settingsContent: { padding: 20, paddingBottom: 60, gap: 14 }, accountId: { color: colors.graphite, fontFamily: mono, fontSize: 10, lineHeight: 16 }, brand: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }, wordmark: { color: colors.ink, fontFamily: serif, fontSize: Platform.OS === "android" ? 25 : 30, fontWeight: "700" }, eyebrow: { color: colors.smoke, fontFamily: mono, fontSize: 10, letterSpacing: 1.7 }, hero: { color: colors.ink, fontFamily: serif, fontSize: 42, lineHeight: 45, textAlign: "center" }, heading: { color: colors.ink, fontFamily: serif, fontSize: 34 }, subheading: { color: colors.ink, fontFamily: serif, fontSize: 25, marginTop: 3 }, body: { color: colors.ink, fontSize: 14, lineHeight: 21 }, bodyMuted: { color: colors.smoke, fontSize: 13, lineHeight: 19 }, transport: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.ash, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 6 }, transportText: { color: colors.graphite, fontFamily: mono, fontSize: 9, textTransform: "uppercase" }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold, marginRight: 5 }, dotOnline: { backgroundColor: colors.green },
  peerPreview: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.ash, borderRadius: 18, backgroundColor: "rgba(251,250,247,0.72)", padding: 14 }, peerPreviewCopy: { flex: 1, minWidth: 0, gap: 4 }, peerPreviewName: { color: colors.ink, fontFamily: serif, fontSize: 22 }, reshuffleButton: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.ash, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, reshuffleText: { color: colors.ink, fontFamily: mono, fontSize: 10, letterSpacing: 1 }, welcomeRow: { flexDirection: "row", alignItems: "center", gap: 14 }, welcomeName: { flex: 1 }, memberAvatar: { marginRight: 4 },
  voiceToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.ash, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }, voiceChip: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.ash, borderRadius: 20, backgroundColor: "rgba(251,250,247,0.7)", paddingHorizontal: 12, paddingVertical: 8 }, voiceChipText: { color: colors.graphite, fontFamily: mono, fontSize: 9, letterSpacing: 0.8 },
  sectionTitle: { marginTop: 18, marginBottom: 5 }, card: { borderWidth: 1, borderColor: colors.ash, borderRadius: 18, backgroundColor: "rgba(251,250,247,0.62)", padding: 17, gap: 12 }, cardStrong: { borderColor: colors.ink }, cardEyebrow: { color: colors.smoke, fontFamily: mono, fontSize: 10, letterSpacing: 1.2 }, cardTitle: { color: colors.ink, fontFamily: serif, fontSize: 21 }, pollQuestion: { color: colors.ink, fontFamily: serif, fontSize: 24, lineHeight: 29 }, detailsTitle: { color: colors.ink, fontFamily: serif, fontSize: 29 }, field: { minHeight: 48, borderWidth: 1, borderColor: colors.ash, borderRadius: 13, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }, fieldMultiline: { minHeight: 74, textAlignVertical: "top" }, button: { minHeight: 47, borderRadius: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, backgroundColor: colors.ink }, buttonQuiet: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.ash }, buttonText: { color: colors.white, fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }, buttonQuietText: { color: colors.ink }, disabled: { opacity: 0.4 }, inline: { flexDirection: "row", justifyContent: "flex-end", gap: 8 }, banner: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.ash, borderRadius: 12, padding: 11 }, bannerText: { color: colors.graphite, fontFamily: mono, fontSize: 9, letterSpacing: 1, textAlign: "center" }, error: { borderWidth: 1, borderColor: colors.crimson, borderRadius: 12, padding: 13, backgroundColor: "#F9E9E8" }, errorCompact: { marginHorizontal: 12, marginTop: 8 }, errorText: { color: colors.crimson, fontFamily: mono, fontSize: 11, lineHeight: 17 }, empty: { borderWidth: 1, borderColor: colors.ash, borderRadius: 18, borderStyle: "dashed", padding: 22, alignItems: "center" },
  invitePreview: { borderLeftWidth: 2, borderLeftColor: colors.green, paddingLeft: 12, gap: 4 }, scannerSafe: { flex: 1, backgroundColor: colors.ink }, scannerHeader: { minHeight: 86, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, eyebrowLight: { color: colors.ash, fontFamily: mono, fontSize: 9, letterSpacing: 1.5 }, scannerTitle: { color: colors.white, fontFamily: serif, fontSize: 29, marginTop: 3 }, scannerClose: { color: colors.white, fontSize: 30 }, scannerCenter: { flex: 1, justifyContent: "center", padding: 28, gap: 14 }, scannerCopy: { color: colors.white, fontSize: 16, lineHeight: 24, textAlign: "center" }, cameraFrame: { flex: 1, overflow: "hidden", marginHorizontal: 18, borderWidth: 1, borderColor: colors.ash }, scanTarget: { position: "absolute", left: "12%", right: "12%", top: "23%", aspectRatio: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.65)", padding: 9 }, scanCorners: { flex: 1, borderWidth: 3, borderColor: colors.white }, scannerHint: { color: colors.ash, fontFamily: mono, fontSize: 9, lineHeight: 15, textAlign: "center", padding: 20 }, scannerError: { position: "absolute", left: 18, right: 18, bottom: 70, backgroundColor: colors.parchment, padding: 12, gap: 9 },
  roomRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.ash, borderRadius: 16, backgroundColor: "rgba(251,250,247,0.5)", padding: 16 }, roomRowMain: { flex: 1, gap: 4 }, roomRowName: { color: colors.ink, fontFamily: mono, fontSize: 13 }, chevron: { color: colors.ink, fontSize: 28 }, fixtureCard: { borderWidth: 1, borderColor: colors.ash, borderRadius: 18, backgroundColor: "rgba(251,250,247,0.45)", padding: 17, gap: 12 }, fixtureSelected: { borderColor: colors.ink, backgroundColor: colors.white }, fixtureTop: { flexDirection: "row", justifyContent: "space-between" }, fixtureStatus: { color: colors.smoke, fontFamily: mono, fontSize: 9 }, live: { color: colors.crimson }, fixtureTeamsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }, fixtureTeams: { color: colors.ink, fontFamily: serif, fontSize: 18 }, fixtureScore: { color: colors.graphite, fontFamily: mono, fontSize: 12 },
  roomHeader: { height: 55, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: colors.ash, paddingHorizontal: 10 }, roundButton: { width: 35, height: 35, borderRadius: 18, alignItems: "center", justifyContent: "center" }, roundButtonText: { fontSize: 30, lineHeight: 32, color: colors.ink }, roomHeaderTitle: { flex: 1 }, roomName: { color: colors.ink, fontFamily: mono, fontSize: 12 }, roomMeta: { color: colors.smoke, fontFamily: mono, fontSize: 7, letterSpacing: 0.7, marginTop: 2 }, memberPill: { borderWidth: 1, borderColor: colors.ash, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 }, memberPillText: { color: colors.graphite, fontFamily: mono, fontSize: 10 }, inviteButton: { backgroundColor: colors.ink, paddingHorizontal: 10, paddingVertical: 8 }, inviteButtonText: { color: colors.white, fontFamily: mono, fontSize: 8, letterSpacing: 0.7 }, fixtureBar: { height: 49, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: colors.ash }, fixtureBarText: { flex: 1, color: colors.ink, fontFamily: mono, fontSize: 11 }, fixtureBarScore: { fontWeight: "700" }, fixtureBarMeta: { color: colors.smoke, fontFamily: mono, fontSize: 8 }, tabs: { height: 48, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.ash }, tab: { flex: 1, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" }, tabActive: { borderBottomColor: colors.ink }, tabText: { color: colors.smoke, fontFamily: mono, fontSize: 8, letterSpacing: 0.7 }, tabTextActive: { color: colors.ink }, tabContent: { padding: 13, paddingBottom: 50, gap: 13 },
  scoreCard: { borderWidth: 1, borderColor: colors.ash, borderRadius: 20, backgroundColor: "rgba(251,250,247,0.58)", padding: 18, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }, team: { width: "28%", alignItems: "center", gap: 5 }, countryFlag: { overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ash, backgroundColor: colors.mist }, teamCode: { color: colors.ink, fontFamily: mono, fontSize: 12, fontWeight: "700" }, teamName: { color: colors.graphite, fontSize: 11, textAlign: "center" }, scoreCenter: { width: "40%", alignItems: "center" }, score: { color: colors.ink, fontFamily: mono, fontSize: 27, fontWeight: "700" }, liveState: { color: colors.crimson, fontFamily: mono, fontSize: 9, marginTop: 6 }, iqStrip: { width: "100%", marginTop: 18, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.ash, flexDirection: "row" }, iqCell: { flex: 1, gap: 4 }, iqLabel: { color: colors.smoke, fontFamily: mono, fontSize: 7, letterSpacing: 0.7 }, iqValue: { color: colors.ink, fontFamily: mono, fontWeight: "700" }, callTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 }, callCopy: { flex: 1, gap: 8 }, pill: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.ash, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, color: colors.smoke, fontFamily: mono, fontSize: 8 }, callPrompt: { color: colors.ink, fontFamily: serif, fontSize: 21, lineHeight: 26 }, callTimer: { color: colors.ink, fontFamily: mono, fontSize: 18 }, option: { minHeight: 46, overflow: "hidden", borderWidth: 1, borderColor: colors.ash, borderRadius: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, optionActive: { borderColor: colors.ink }, optionFill: { position: "absolute", inset: 0, right: undefined, backgroundColor: colors.mist, opacity: 0.65 }, optionText: { zIndex: 1, flex: 1, color: colors.ink, fontFamily: mono, fontSize: 12 }, optionShare: { zIndex: 1, color: colors.graphite, fontFamily: mono, fontSize: 11 }, pollOption: { minHeight: 48, overflow: "hidden", borderWidth: 1, borderColor: colors.ash, borderRadius: 16, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, pollOptionActive: { borderColor: colors.ink }, pollOptionFill: { position: "absolute", inset: 0, right: undefined, backgroundColor: colors.mist, opacity: 0.72 }, pollOptionText: { zIndex: 1, flex: 1, color: colors.ink, fontFamily: mono, fontSize: 13 }, pollOptionShare: { zIndex: 1, color: colors.graphite, fontFamily: mono, fontSize: 12 }, receipt: { borderTopWidth: 1, borderTopColor: colors.ash, paddingTop: 11, color: colors.blue, fontFamily: mono, fontSize: 9 }, hint: { color: colors.smoke, fontFamily: mono, fontSize: 9, lineHeight: 14 }, timelineRow: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ash }, timelineMinute: { width: 32, color: colors.ink, fontFamily: mono, fontSize: 11 }, timelineCopy: { flex: 1 }, timelineType: { color: colors.smoke, fontFamily: mono, fontSize: 8, letterSpacing: 0.7 }, pressureTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, pressureValue: { color: colors.ink, fontFamily: mono, fontSize: 13, fontWeight: "700" }, pressureTrack: { height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: colors.mist }, pressureFill: { height: "100%", borderRadius: 4, backgroundColor: colors.crimson },
  chatContent: { padding: 15, paddingBottom: 28, gap: 15 }, messageRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, messageRowMine: { flexDirection: "row-reverse" }, avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.ash, backgroundColor: "rgba(251,250,247,0.7)", alignItems: "center", justifyContent: "center" }, avatarMine: { borderColor: colors.blue, backgroundColor: colors.blue }, avatarText: { color: colors.graphite, fontFamily: mono, fontSize: 9, fontWeight: "700" }, avatarTextMine: { color: colors.white }, messageColumn: { flex: 1, alignItems: "flex-start" }, messageColumnMine: { alignItems: "flex-end" }, message: { maxWidth: "94%", borderRadius: 18, backgroundColor: "rgba(251,250,247,0.9)", paddingHorizontal: 15, paddingVertical: 12, gap: 7 }, messageMine: { backgroundColor: colors.mist }, messageTop: { maxWidth: "94%", flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 }, messageTopMine: { flexDirection: "row-reverse" }, messageAuthor: { color: colors.ink, fontFamily: mono, fontSize: 9, fontWeight: "700" }, messageTime: { color: colors.smoke, fontFamily: mono, fontSize: 8 }, messageText: { color: colors.ink, fontSize: 15, lineHeight: 21 }, reactions: { maxWidth: "96%", flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 }, reactionsMine: { justifyContent: "flex-end" }, reaction: { borderWidth: 1, borderColor: colors.ash, borderRadius: 14, backgroundColor: "rgba(251,250,247,0.72)", paddingHorizontal: 7, paddingVertical: 4 }, reactionCount: { borderWidth: 1, borderColor: colors.ash, borderRadius: 14, paddingHorizontal: 7, paddingVertical: 4, color: colors.graphite, fontSize: 11 }, systemMessage: { alignSelf: "center", borderRadius: 14, backgroundColor: "rgba(221,228,255,0.5)", paddingHorizontal: 12, paddingVertical: 7 }, systemText: { color: colors.smoke, fontFamily: mono, fontSize: 9, textAlign: "center" }, typing: { color: colors.smoke, fontFamily: mono, fontSize: 9 }, composer: { borderTopWidth: 1, borderTopColor: colors.ash, backgroundColor: colors.parchment, padding: 10 }, composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 }, composerActions: { gap: 1, marginBottom: 9, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: colors.ash }, composerAction: { backgroundColor: colors.white, paddingHorizontal: 15, paddingVertical: 12 }, composerActionTitle: { color: colors.ink, fontSize: 14, fontWeight: "600" }, composerInput: { flex: 1, maxHeight: 110, minHeight: 43, borderWidth: 1, borderColor: colors.ash, borderRadius: 22, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 10, color: colors.ink }, plusButton: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: colors.ash, alignItems: "center", justifyContent: "center" }, plus: { color: colors.ink, fontSize: 20 }, sendButton: { width: 43, height: 43, borderRadius: 22, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" }, sendText: { color: colors.white, fontSize: 22 }, pollComposer: { gap: 8 }, pollComposerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, wagerCta: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", borderRadius: 22, backgroundColor: colors.ink, paddingHorizontal: 17, marginTop: 2 }, wagerCtaText: { color: colors.white, fontFamily: mono, fontSize: 10, letterSpacing: 0.7 }, wagerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(25,24,22,0.52)" }, wagerSheet: { maxHeight: "88%", backgroundColor: colors.parchment, padding: 20, gap: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24 }, wagerHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, wagerQuestion: { color: colors.ink, fontFamily: serif, fontSize: 28, lineHeight: 33, marginTop: 5 }, wagerChoices: { gap: 10 }, wagerChoice: { minHeight: 54, borderWidth: 1, borderColor: colors.ash, backgroundColor: colors.white, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, wagerChoiceActive: { borderColor: colors.ink, backgroundColor: colors.ink }, wagerChoiceText: { color: colors.ink, fontFamily: mono, fontSize: 13 }, wagerChoiceTextActive: { color: colors.white }, wagerSelection: { minHeight: 48, borderWidth: 1, borderColor: colors.ink, backgroundColor: colors.mist, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, stakePresets: { flexDirection: "row", gap: 8 }, stakePreset: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.ash, alignItems: "center", justifyContent: "center" },
  pollKindTabs: { flexDirection: "row", borderWidth: 1, borderColor: colors.ash, borderRadius: 22, padding: 3 }, pollKindTab: { flex: 1, minHeight: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }, pollKindTabActive: { backgroundColor: colors.ink }, pollKindTabText: { color: colors.graphite, fontFamily: mono, fontSize: 9, letterSpacing: 0.8 }, pollKindTabTextActive: { color: colors.white }, rulebookPreview: { gap: 7, borderWidth: 1, borderColor: colors.blue, borderRadius: 14, backgroundColor: colors.mist, padding: 13 },
  marketVerification: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, marketVerificationError: { alignItems: "flex-start", gap: 8 }, marketInfoButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.ash, alignItems: "center", justifyContent: "center" }, marketInfoText: { color: colors.graphite, fontFamily: mono, fontSize: 14, fontWeight: "700" }, marketErrorCopy: { maxWidth: 310, gap: 8 }, marketRetry: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4 },
  attachment: { borderWidth: 1, borderColor: colors.ash, padding: 10, gap: 3 }, attachmentName: { color: colors.ink, fontFamily: mono, fontSize: 11 }, attachmentAction: { color: colors.blue, fontFamily: mono, fontSize: 8, marginTop: 5 }, threadAction: { borderWidth: 1, borderColor: colors.ash, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5 }, threadActionText: { color: colors.graphite, fontFamily: mono, fontSize: 8 }, threadHeader: { minHeight: 70, borderBottomWidth: 1, borderBottomColor: colors.ash, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, threadClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, threadCloseText: { color: colors.ink, fontSize: 30 },
  linkPreviewList: { marginTop: 8, gap: 8 }, linkPreviewLoading: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.ash, borderRadius: 14, paddingHorizontal: 14, backgroundColor: colors.parchment }, linkPreviewFallback: { minHeight: 72, justifyContent: "center", gap: 3, borderWidth: 1, borderColor: colors.ash, borderRadius: 14, padding: 12, backgroundColor: colors.parchment }, linkPreview: { gap: 5, borderWidth: 1, borderColor: colors.ash, borderRadius: 14, padding: 13, backgroundColor: colors.parchment }, linkPreviewSite: { color: colors.smoke, fontFamily: mono, fontSize: 8, letterSpacing: 0.8 }, linkPreviewTitle: { color: colors.ink, fontFamily: serif, fontSize: 18, lineHeight: 22 }, linkPreviewDescription: { color: colors.graphite, fontSize: 12, lineHeight: 17 }, xEmbed: { gap: 13, overflow: "hidden", borderWidth: 1, borderColor: colors.ash, borderRadius: 14, backgroundColor: colors.white, padding: 14 }, xEmbedHeader: { flexDirection: "row", alignItems: "center", gap: 10 }, xMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }, xMarkText: { color: colors.white, fontFamily: mono, fontSize: 14, fontWeight: "700" }, xAuthor: { color: colors.ink, fontSize: 13, fontWeight: "700" }, xHandle: { color: colors.smoke, fontFamily: mono, fontSize: 9, marginTop: 2 }, xPostText: { color: colors.ink, fontSize: 16, lineHeight: 22 }, xSource: { color: colors.smoke, fontFamily: mono, fontSize: 7, letterSpacing: 0.8 },
  stats: { flexDirection: "row", borderWidth: 1, borderColor: colors.ash, marginTop: 10 }, stat: { flex: 1, alignItems: "center", paddingVertical: 12, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.ash }, statValue: { color: colors.ink, fontFamily: mono, fontSize: 16 }, statLabel: { color: colors.smoke, fontFamily: mono, fontSize: 7, marginTop: 4 }, disclosure: { minHeight: 64, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.ash, borderRadius: 16, backgroundColor: "rgba(251,250,247,0.5)", paddingHorizontal: 16, paddingVertical: 12 }, disclosureDanger: { borderColor: "rgba(182,41,49,0.35)" }, disclosureLabel: { color: colors.ink, fontSize: 14, fontWeight: "600" }, disclosureMark: { color: colors.smoke, fontSize: 20 }, memberRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ash }, memberCopy: { flex: 1 }, memberActions: { flexDirection: "row", alignItems: "center", gap: 10 }, smallAction: { color: colors.blue, fontFamily: mono, fontSize: 8 }, dangerText: { color: colors.crimson }, memberName: { color: colors.ink, fontSize: 14 }, memberRole: { color: colors.smoke, fontFamily: mono, fontSize: 8, marginTop: 3 }, presence: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ash }, presenceOnline: { backgroundColor: colors.green }, reasonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, reason: { borderWidth: 1, borderColor: colors.ash, paddingHorizontal: 8, paddingVertical: 6 }, reasonActive: { borderColor: colors.ink, backgroundColor: colors.mist }, reasonText: { color: colors.graphite, fontFamily: mono, fontSize: 7 },
});
