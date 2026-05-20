/**
 * OCL Nexus — Traefik ingress manifest builders.
 *
 * Pure functions — no I/O, no side effects.
 * Returned objects are passed directly to customApi.createNamespacedCustomObject().
 */
import { INFRA_DOMAIN } from "@/lib/config/nexus";

/** Build a Traefik ForwardAuth Middleware manifest body. */
export function buildMiddleware(
  shortId: string,
  namespace: string,
  forwardAuthUrl: string
): object {
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: `auth-${shortId}`,
      namespace,
      labels: { instance: shortId },
    },
    spec: {
      forwardAuth: {
        address: forwardAuthUrl,
        trustForwardHeader: true,
        authResponseHeaders: ["x-forwarded-user"],
      },
    },
  };
}

/** Build a Traefik IngressRoute manifest body. */
export function buildIngressRoute(
  shortId: string,
  namespace: string,
  subdomain: string
): object {
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: `ingress-${shortId}`,
      namespace,
      labels: { instance: shortId },
      annotations: {
        "traefik.ingress.kubernetes.io/router.timeout": "300s",
      },
    },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          match: `Host(\`${subdomain}.${INFRA_DOMAIN}\`)`,
          kind: "Rule",
          services: [{ name: `svc-${shortId}`, port: 80 }],
          middlewares: [{ name: `auth-${shortId}` }],
        },
      ],
      tls: {},
    },
  };
}
