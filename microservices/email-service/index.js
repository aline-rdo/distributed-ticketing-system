import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { sendEmail } from "./db.js";

const checkoutPath = fileURLToPath(
  new URL("../../proto/checkout.proto", import.meta.url)
);

const healthPath = fileURLToPath(
  new URL("../../proto/health.proto", import.meta.url)
);

const loaderOptions = {
  keepCase: true,
  defaults: false,
  oneofs: true,
};

const checkout = grpc.loadPackageDefinition(
  protoLoader.loadSync(checkoutPath, loaderOptions)
).cin0143.entrega1;

const health = grpc.loadPackageDefinition(
  protoLoader.loadSync(healthPath, loaderOptions)
).grpc.health.v1;

const validText = (value) =>
  typeof value === "string" && value.trim().length > 0;

const invalidArgument = (message) => ({
  code: grpc.status.INVALID_ARGUMENT,
  details: message,
});

const analyticsAddress =
  process.env.ANALYTICS_SERVICE_ADDRESS ||
  "localhost:8003";

const analytics = new checkout.AnalyticsService(
  analyticsAddress,
  grpc.credentials.createInsecure()
);

function recordEmailEvent(userId, ticketId, emailResult) {
  return new Promise((resolve, reject) => {
    analytics.recordEvent(
      {
        type: "emails",
        email: {
          userId,
          ticketId,
          emailResult,
        },
      },
      (error, response) => {
        if (error) return reject(error);
        resolve(response);
      }
    );
  });
}

async function sendEmailHandler(call, callback) {
  const { userId, ticketId, ticketResult } = call.request;

  if (
    !validText(userId) ||
    !validText(ticketId) ||
    ticketResult !== "success"
  ) {
    return callback(
      invalidArgument("Invalid email request")
    );
  }

  try {
    // Mantém o atraso original de três segundos.
    const emailResult = await sendEmail(
      ticketId,
      userId,
      ticketResult
    );

    // Falhas retornadas pelo analytics não impedem o envio.
    try {
      await recordEmailEvent(
        userId,
        ticketId,
        emailResult
      );
    } catch (error) {
      console.error(
        "Analytics reporting failed:",
        error.message
      );
    }

    callback(null, { emailResult });
  } catch (error) {
    console.error("Email processing failed:", error);
    callback({
      code: grpc.status.INTERNAL,
      details: "Email processing failed",
    });
  }
}

const server = new grpc.Server();

server.addService(
  checkout.EmailService.service,
  { sendEmail: sendEmailHandler }
);

server.addService(
  health.Health.service,
  {
    check(call, callback) {
      callback(null, { status: "SERVING" });
    },
  }
);

const port = process.env.PORT || 8002;

server.bindAsync(
  `0.0.0.0:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    console.log(
      `Email gRPC service running on port ${port}`
    );
  }
);
