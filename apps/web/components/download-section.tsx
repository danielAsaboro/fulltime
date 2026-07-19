import { Code2, Download, Laptop, Smartphone } from "lucide-react";

import type { FullTimeDownload } from "@/lib/downloads";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, Eyebrow } from "@/components/ui/primitives";

const ICONS = {
  desktop: Laptop,
  ios: Smartphone,
  android: Smartphone,
};

export function DownloadSection({ downloads }: { downloads: FullTimeDownload[] }) {
  if (!downloads.length) return null;

  return (
    <section id="download" className="scroll-mt-6 border-t border-ash">
      <Container className="py-16 sm:py-20">
        <div className="max-w-3xl space-y-3">
          <Eyebrow>Get FullTime</Eyebrow>
          <h2 className="text-heading-sm text-off-black">Your room starts on your device.</h2>
          <p className="max-w-2xl font-mono text-body-sm text-graphite">
            Install FullTime to create a peer identity, keep encrypted room history locally, and connect
            directly with the people you invite.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {downloads.map((release) => {
            const PlatformIcon = ICONS[release.platform];
            return (
              <Card key={release.platform} padding="card" className="flex min-h-72 flex-col">
                <PlatformIcon className="size-6 text-off-black" aria-hidden />
                <h3 className="mt-8 text-subheading text-off-black">{release.name}</h3>
                <p className="mt-3 flex-1 font-mono text-body-sm text-graphite">{release.description}</p>
                <Button href={release.url} variant="ghost" size="sm" className="mt-8 self-start">
                  {release.delivery === "source" ? (
                    <Code2 className="size-4" aria-hidden />
                  ) : (
                    <Download className="size-4" aria-hidden />
                  )}
                  {release.action}
                </Button>
              </Card>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
