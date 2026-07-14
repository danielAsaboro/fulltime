const PARTIAL_INVITE_MESSAGE = "The invite was only partially read. Copy it again or rescan the complete QR code.";

export function inviteCodeFromInput(value: string): string {
  const clean = value.trim();
  if (clean.startsWith("ft2.")) return completeInvite(clean);
  try {
    const url = new URL(clean);
    const query = url.searchParams.get("invite") ?? url.searchParams.get("code");
    if (query?.startsWith("ft2.")) return completeInvite(query);
    const parts = url.pathname.split("/").filter(Boolean);
    const join = parts.lastIndexOf("join");
    if (join >= 0 && parts[join + 1]) {
      const code = decodeURIComponent(parts[join + 1]);
      if (code.startsWith("ft2.")) return completeInvite(code);
    }
  } catch { /* the precise FullTime invite error is reported below */ }
  throw new Error("This does not contain a FullTime room invite.");
}

function completeInvite(code: string): string {
  if (code.split(".").length !== 4 && code.split(".").length !== 7) throw new Error(PARTIAL_INVITE_MESSAGE);
  return code;
}
