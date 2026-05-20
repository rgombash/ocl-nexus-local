import DocsClient from "./docs-client";

export const metadata = {
  title: "Documentation — OCL Nexus Local",
  description:
    "Get started with OCL Nexus Local: generate an API key and connect your AI agent to your local K3s compute fabric.",
};

export default function DocsPage() {
  return <DocsClient />;
}
