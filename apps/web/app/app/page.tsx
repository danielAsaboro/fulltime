import { AppDashboard } from "@/components/app-dashboard";
import { Container } from "@/components/ui/primitives";
import { SiteNav } from "@/components/site-nav";

export default function ApplicationHome() {
  return <><SiteNav border /><main><Container className="max-w-5xl py-10 sm:py-14"><AppDashboard /></Container></main></>;
}
