// instrumentation.node.ts
//
// Configures the OpenTelemetry SDK to export traces to Jaeger via OTLP/HTTP.
// Only ever imported from instrumentation.ts when running in the Node.js
// runtime (see the NEXT_RUNTIME guard there).
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "ai-aug-workflows-agents",
  }),
  spanProcessor: new SimpleSpanProcessor(
    new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
  ),
});

sdk.start();
