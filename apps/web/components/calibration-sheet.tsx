"use client";

import { useState } from "react";

import { STREAM_DELAY_PRESETS, type CalibrationMethod, type StreamDelayProfile } from "@fulltime/shared";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

const PRESETS: { key: StreamDelayProfile; label: string; note: string }[] = [
  { key: "stadium", label: "Stadium / live TV", note: "≈3s" },
  { key: "liveTv", label: "Broadcast", note: "≈8s" },
  { key: "cable", label: "Cable box", note: "≈25s" },
  { key: "appStream", label: "App stream", note: "≈42s" },
];

/**
 * Quiet calibration. Tell us where your stream is and FullTime won't spoil you.
 * A comfort feature, not the headline — presets + a tap-to-calibrate fallback.
 */
export function CalibrationSheet({
  open,
  onClose,
  initialSeconds,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialSeconds: number | null;
  onSave: (seconds: number, method: CalibrationMethod) => void;
}) {
  const [seconds, setSeconds] = useState(initialSeconds ?? STREAM_DELAY_PRESETS.liveTv);
  const [method, setMethod] = useState<CalibrationMethod>("preset");

  const save = () => {
    onSave(seconds, method);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Spoiler-safe"
      title="Where's your stream?"
      footer={
        <Button variant="primary" fullWidth onClick={save}>
          Save delay · +{seconds}s
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="font-mono text-body-sm text-graphite">
          Tell us your delay and the room releases every moment on your clock. This never touches how
          calls settle — only when you see them.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => {
            const value = STREAM_DELAY_PRESETS[preset.key];
            const active = seconds === value;
            return (
              <button
                key={preset.key}
                onClick={() => {
                  setSeconds(value);
                  setMethod("preset");
                }}
                className={cn(
                  "rounded-lg border p-3 text-left",
                  active ? "border-off-black bg-periwinkle-mist/40" : "border-ash",
                )}
              >
                <p className="font-mono text-body-sm text-off-black">{preset.label}</p>
                <p className="font-mono text-caption tabular text-smoke">{preset.note}</p>
              </button>
            );
          })}
        </div>

        <label className="block space-y-2">
          <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">
            Fine-tune · {seconds}s
          </span>
          <input
            type="range"
            min={0}
            max={90}
            value={seconds}
            onChange={(e) => {
              setSeconds(Number(e.target.value));
              setMethod("manual-minute");
            }}
            className="w-full accent-[var(--color-lake-blue)]"
          />
        </label>
      </div>
    </Sheet>
  );
}
