import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda"
import {
  ServiceDiscoveryClient,
  GetInstancesHealthStatusCommand,
  InstanceNotFound,
} from "@aws-sdk/client-servicediscovery"

const client = new ServiceDiscoveryClient({ region: process.env.AWS_REGION })

const cache: { [serviceId: string]: { status: boolean; timestamp: number } } =
  {}
const CACHE_TTL_MS = 1000

async function checkReadiness(serviceId: string): Promise<boolean> {
  const now = Date.now()
  if (cache[serviceId] && now - cache[serviceId].timestamp < CACHE_TTL_MS) {
    return cache[serviceId].status
  }
  try {
    const command = new GetInstancesHealthStatusCommand({
      ServiceId: serviceId,
    })
    const response = await client.send(command)
    const status = Object.values(response.Status || {}).some(
      (status) => status === "HEALTHY",
    )
    cache[serviceId] = { status, timestamp: now }
    return status
  } catch (error) {
    if (error instanceof InstanceNotFound) {
      cache[serviceId] = { status: false, timestamp: now }
    } else {
      console.error("Error checking service health:", error)
    }
    return false
  }
}

function buildResponse(
  statusCode: number,
  body: string | object,
  headers: Record<string, string> = {},
): APIGatewayProxyResult {
  return {
    statusCode,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  }
}

// NOTE: We should probably move this to a separate file
const loadingHtml = (redirectUrl: string) => `
<!doctype html>
<html>
  <head>
    <title>Loading ...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        font-family: Arial, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background-color: #121212;
        color: #e0e0e0;
      }
      .container {
        text-align: center;
        padding: 20px;
        background-color: #1e1e1e;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(255, 255, 255, 0.1);
        max-width: 90%;
      }
      h1 {
        color: #ffffff;
      }
      p {
        color: #b0b0b0;
      }
      .spinner {
        border: 4px solid #333333;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 20px auto;
      }
      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 600px) {
        body {
          padding: 0 15px;
        }
        .container {
          padding: 15px;
          width: 100%;
          box-sizing: border-box;
        }
        h1 {
          font-size: 1.5em;
        }
        p {
          font-size: 0.9em;
        }
      }
    </style>
    <script>
      let attempts = 0;
      const maxAttempts = 24;
      function checkStatus() {
        fetch("/status")
          .then((response) => response.json())
          .then((data) => {
            if (data.ready) {
              window.location.href = "${redirectUrl}";
            } else if (attempts++ < maxAttempts) {
              setTimeout(checkStatus, 5000);
            } else {
              document.getElementById("message").innerHTML =
                "Application took longer to wake up than expected - please try again later";
              document.getElementById("spinner").style.display = "none";
            }
          })
          .catch((error) => {
            console.error("Error:", error);
            if (attempts++ < maxAttempts) {
              setTimeout(checkStatus, 5000);
            } else {
              document.getElementById("message").innerHTML =
                "An error occurred while checking the status of the application - please try again later.";
              document.getElementById("spinner").style.display = "none";
            }
          });
      }
      window.onload = checkStatus;
    </script>
  </head>
  <body>
    <div class="container">
      <h1>Application is in hibernation &#128564;</h1>
      <p id="message">
        Please wait while we wake it up from its slumber - you will
        automatically be redirected once it is ready for you &#9889;
      </p>

      <div id="spinner" class="spinner"></div>
    </div>
  </body>
</html>
`

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResult> => {
  const serviceId = process.env.SERVICE_ID
  let redirectUrl = process.env.REDIRECT_URL

  if (!serviceId) {
    console.error("Missing required environment variables")
    return buildResponse(500, { error: "Internal server error" })
  }

  redirectUrl = redirectUrl || `https://${event.requestContext.domainName}/app/`

  try {
    const ready = await checkReadiness(serviceId)
    if (event.rawPath === "/") {
      if (ready) {
        return buildResponse(302, "", { Location: redirectUrl })
      } else {
        return buildResponse(200, loadingHtml(redirectUrl), {
          "Content-Type": "text/html",
        })
      }
    } else if (event.rawPath === "/status") {
      return buildResponse(200, { ready })
    }
  } catch (error) {
    console.error("Error checking service health:", error)
    return buildResponse(500, { error: "Internal server error" })
  }
  return buildResponse(404, { error: "Not found" })
}
