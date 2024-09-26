import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as logs from "aws-cdk-lib/aws-logs"
import * as constructs from "constructs"

export interface GrafanaCognitoAuthProps {
  /**
   * The Cognito User Pool to use for authentication
   */
  userPool: cognito.IUserPool
  /**
   * The domain of the Cognito user pool
   *
   * @example "auth.example.com"
   */
  cognitoDomain: string
  /**
   * The domain Grafana is being served from
   *
   * @example "grafana.example.com"
   */
  grafanaDomain: string
  /**
   * The sub-path Grafana is being served from, if any
   * @example "/grafana/"
   */
  grafanaSubPath?: string
  /**
   * Authorization rules for the different
   * built-in Grafana roles. Each role can be assigned based
   * on a Cognito user emails and/or Cognito user pool groups.
   *
   * @remarks
   * The construct does not set up the Grafana user pool groups for you.
   *
   * @example
   * ```typescript
   * {
   *   authorization: {
   *     serverAdmins: {
   *       emails: ["user@example.com"],
   *     },
   *     viewers: {
   *       groups: ["grafana-default"]
   *     }
   *   }
   * }
   * ```
   */
  authorization: {
    /**
     * @default - users that are not assigned a role based on
     * their email or group membership is not granted access
     */
    defaultRole?: "GrafanaAdmin" | "Admin" | "Editor" | "Viewer"
    /**
     * The principals to grant the `GrafanaAdmin` role
     */
    serverAdmins: {
      emails?: string[]
      groups?: string[]
    }
    /**
     * The principals to grant the `Admin` role
     */
    admins?: {
      emails?: string[]
      groups?: string[]
    }
    /**
     * The principals to grant the `Editor` role
     */
    editors?: {
      emails?: string[]
      groups?: string[]
    }
    /**
     * The principals to grant the `Viewer` role
     */
    viewers?: {
      emails?: string[]
      groups?: string[]
    }
  }
}

// The default Grafana configuration used by this construct
// (with some best-effort documentation)
type GrafanaConfig = {
  security: {
    disableInitialAdminCreation: boolean
  }
  auth: {
    /**
     * Configuration for using Cognito as OAuth provider
     */
    genericOauth: {
      enabled: boolean
      name: string
      allowSignUp: boolean
      autoLogin: boolean
      usePkce: boolean
      useRefreshToken: boolean
      clientId: string | sm.ISecret | ssm.IParameter
      clientSecret: sm.ISecret | ssm.IParameter
      scopes: string
      authUrl: string
      tokenUrl: string
      apiUrl: string
      signoutRedirectUrl: string
      allowAssignGrafanaAdmin: boolean
      roleAttributeStrict: boolean
      /**
       * JMES path that returns the Grafana role
       * an authenticated user should be assigned
       */
      roleAttributePath: string
      nameAttributePath: string
      loginAttributePath: string
    }
    basic: {
      enabled: boolean
    }
    anonymous: {
      enabled: boolean
    }
    disableLoginForm: boolean
    disableSignoutMenu: boolean
  }
  users: {
    /**
     * Default role for new users
     */
    autoAssignOrgRole: string
  }
  server: {
    /**
     * The full URL to Grafana
     */
    rootUrl: string
    /**
     * Whether Grafana is being served from a sub-path or not
     */
    serveFromSubPath: boolean
  }
}

// A type that allows everything in GrafanaConfig (as optional),
// as well as arbitrary key-value pairs
type FlexibleGrafanaConfig = {
  [K in keyof GrafanaConfig]?: GrafanaConfig[K] extends object
    ? {
        [P in keyof GrafanaConfig[K]]?: GrafanaConfig[K][P] extends object
          ? {
              [Q in keyof GrafanaConfig[K][P]]?: GrafanaConfig[K][P][Q]
            }
          : GrafanaConfig[K][P]
      }
    : GrafanaConfig[K]
} & Record<string, unknown>

type GrafanaConfigValue =
  | { [key: string]: GrafanaConfigValue }
  | string
  | number
  | boolean
  | sm.ISecret
  | ssm.IParameter

/**
 * Environment variables that can be used to customize Grafana
 */
type GrafanaEnvironment = {
  /**
   * Environment variables containing string values
   */
  strings: {
    [key: string]: string
  }
  /**
   * Environment variables containing SSM parameters
   */
  parameters: {
    [key: string]: ssm.IParameter
  }
  /**
   * Environment variables containing Secrets Manager secrets
   */
  secrets: {
    [key: string]: sm.ISecret
  }
}

/**
 * Type guard to check if a value is a pure JavaScript object.
 */
const isPureObject = (v: unknown): v is Record<string, unknown> =>
  Object.prototype.toString.call(v) === "[object Object]" &&
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  v.constructor === Object &&
  Object.getPrototypeOf(v) === Object.prototype

/**
 * Type guard to check if a value is a Secrets Manager secret.
 */
const isSecret = (v: unknown): v is sm.ISecret =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "secretName" in v

/**
 * Type guard to check if a value is an SSM parameter.
 */
const isParameter = (v: unknown): v is ssm.IParameter =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  "parameterName" in v

/**
 * Type guard to check if a value is a valid Grafana configuration value.
 */
const isGrafanaConfigValue = (v: unknown): v is GrafanaConfigValue =>
  isPureObject(v) ||
  isSecret(v) ||
  isParameter(v) ||
  typeof v === "string" ||
  typeof v === "number" ||
  typeof v === "boolean"

/**
 * Creates a Cognito user pool client and prepares all the
 * required Grafana configuration in order to use Cognito as
 * the OAuth2 provider.
 *
 * This allows you to control access to Grafana through Cognito,
 * and automatically map Grafana roles (e.g., `Editor`, `Viewer`, etc.)
 * to users based on their email and/or Cognito group membership.
 */
export class GrafanaCognitoAuth extends constructs.Construct {
  /**
   * The Cognito User Pool Client created for Grafana
   */
  public readonly userPoolClient: cognito.IUserPoolClient

  /**
   * Pre-configured container definition that can be used in an ECS
   * task definition
   */
  public readonly containerDefinitionOpts: ecs.ContainerDefinitionOptions

  /**
   * Environment variables that can be used to configure Grafana
   */
  public readonly environment: GrafanaEnvironment

  constructor(
    scope: constructs.Construct,
    id: string,
    props: GrafanaCognitoAuthProps,
  ) {
    super(scope, id)

    if (
      !props.authorization.serverAdmins.emails?.length &&
      !props.authorization.serverAdmins.groups?.length
    ) {
      throw new Error(
        "At least one Grafana server administrator must be configured",
      )
    }
    if (cdk.Token.isUnresolved(props.grafanaSubPath)) {
      throw new Error("The Grafana sub-path can not be a CDK token")
    }
    const grafanaUrl = `https://${props.grafanaDomain}${
      props.grafanaSubPath ? "/" + props.grafanaSubPath.replace(/^\//, "") : ""
    }`

    const grafanaUrlWithoutTrailingSlash = grafanaUrl.replace(/\/+$/, "")

    // NOTE: We need to do some special handling
    // here as the Grafana domain may be a CDK token
    const encodedLogoutUrl =
      encodeURIComponent("https://") +
      props.grafanaDomain +
      encodeURIComponent(
        props.grafanaSubPath
          ? "/" + props.grafanaSubPath.replace(/^\//, "")
          : "",
      )
    const cognitoUrl = `https://${props.cognitoDomain}`
    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: props.userPool,
      generateSecret: true,
      preventUserExistenceErrors: true,
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        // NOTE: Cognito requires email to be writable
        email: true,
      }),
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        logoutUrls: [grafanaUrl],
        callbackUrls: [`${grafanaUrlWithoutTrailingSlash}/login/generic_oauth`],
      },
    })

    const roleAttributePath = GrafanaCognitoAuth.generateRoleAttributePath(
      props.authorization,
    )
    const clientSecret = new sm.Secret(this, "ClientSecret", {
      secretStringValue: this.userPoolClient.userPoolClientSecret,
    })

    const grafanaConfig: GrafanaConfig = {
      security: {
        disableInitialAdminCreation: true,
      },
      server: {
        rootUrl: grafanaUrl,
        serveFromSubPath: !!props.grafanaSubPath,
      },
      users: {
        autoAssignOrgRole: "None",
      },
      auth: {
        disableLoginForm: true,
        disableSignoutMenu: false,
        basic: {
          enabled: false,
        },
        anonymous: {
          enabled: false,
        },
        genericOauth: {
          enabled: true,
          name: "Amazon Cognito",
          clientId: this.userPoolClient.userPoolClientId,
          clientSecret: clientSecret,
          scopes: "openid profile email phone aws.cognito.signin.user.admin",
          authUrl: `${cognitoUrl}/oauth2/authorize`,
          tokenUrl: `${cognitoUrl}/oauth2/token`,
          apiUrl: `${cognitoUrl}/oauth2/userInfo`,
          signoutRedirectUrl: `${cognitoUrl}/logout?client_id=${this.userPoolClient.userPoolClientId}&logout_uri=${encodedLogoutUrl}`,
          allowAssignGrafanaAdmin: true,
          usePkce: true,
          useRefreshToken: true,
          autoLogin: false,
          allowSignUp: true,
          roleAttributeStrict: true,
          roleAttributePath,
          loginAttributePath: "username",
          nameAttributePath: "name || preferred_username || email || username",
        },
      },
    }
    this.environment =
      GrafanaCognitoAuth.generateEnvironmentVariables(grafanaConfig)
    this.containerDefinitionOpts = {
      image: ecs.ContainerImage.fromRegistry(
        // renovate: datasource=docker depName=grafana/grafana-oss
        "grafana/grafana-oss:11.2.1@sha256:999ac5b9b357e31be729d990e76dc3749285ca0ebd1ce1294a5b69cf6435d869",
      ),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "ecs",
        logRetention: logs.RetentionDays.TWO_WEEKS,
      }),
      portMappings: [{ containerPort: 3000 }],
      environment: this.environment.strings,
      secrets: {
        ...Object.fromEntries(
          Object.entries(this.environment.secrets).map(([key, secret]) => [
            key,
            ecs.Secret.fromSecretsManager(secret),
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(this.environment.parameters).map(
            ([key, parameter]) => [key, ecs.Secret.fromSsmParameter(parameter)],
          ),
        ),
      },
    }
  }

  /**
   * Generate a JMES path that Grafana can use to map Cognito groups
   * and user emails to built-in Grafana roles.
   */
  public static generateRoleAttributePath(
    authorization: GrafanaCognitoAuthProps["authorization"],
  ): string {
    const mappings = [
      { roleName: "GrafanaAdmin", principals: authorization.serverAdmins },
      { roleName: "Admin", principals: authorization.admins },
      { roleName: "Editor", principals: authorization.editors },
      { roleName: "Viewer", principals: authorization.viewers },
    ]
    const defaultRole = authorization.defaultRole
      ? `'${authorization.defaultRole}'`
      : "null"

    const rules = mappings
      .filter(
        (role) =>
          role.principals &&
          (role.principals.emails?.length || role.principals.groups?.length),
      )
      .map((role) => {
        const roleRules = []
        if (role.principals?.groups?.length) {
          roleRules.push(
            role.principals.groups
              // NOTE: We fallback to an empty array if the `cognito:groups` claim is
              // missing from the JWT, which will be the case for users who
              // aren't assigned to any groups.
              .map((g) => `contains("cognito:groups" || \`[]\`, '${g}')`)
              .join(" || "),
          )
        }
        if (role.principals?.emails?.length) {
          roleRules.push(
            `contains([${role.principals.emails
              .map((u) => `'${u}'`)
              .join(",")}], email)`,
          )
        }
        return `(${roleRules.join(" || ")} && '${role.roleName}')`
      })
    return rules.length
      ? rules.join(" || ") + " || " + defaultRole
      : defaultRole
  }
  /**
   * Generate environment variables that can be used to configure Grafana
   * by transforming arbitrarily nested objects to variables in the format
   * used by Grafana (e.g., `GF_MY_GRAFANA_VARIABLE`). The construct uses this
   * function internally, but it can be used by consumers to override values,
   * create their own config, etc.
   *
   * You can supply JSON primitives, Secrets Manager secrets and SSM parameters.
   *
   * The following resources can be used to determine available configuration values:
   * - https://github.com/grafana/grafana/blob/main/conf/defaults.ini
   * - https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/
   *
   * @example
   * ```typescript
   * GrafanaCognitoAuth.generateEnvironmentVariables({
   *   hello: {
   *     world: ":-)"
   *   }
   * })
   * // returns { strings: GF_HELLO_WORLD: ":-)"}
   * ```
   */
  public static generateEnvironmentVariables(
    config: FlexibleGrafanaConfig,
  ): GrafanaEnvironment {
    const prefix = "GF"
    const variables: GrafanaEnvironment = {
      strings: {},
      parameters: {},
      secrets: {},
    }
    if (!isGrafanaConfigValue(config)) {
      throw new Error(
        "The Grafana configuration can only contain JSON primitives, Secrets Manager secrets and SSM parameters",
      )
    }
    const stack: Array<[string[], GrafanaConfigValue]> = [[[], config]]
    while (stack.length > 0) {
      const [path, value] = stack.pop()!
      if (isPureObject(value)) {
        for (const [key, subValue] of Object.entries(value)) {
          const formattedKey = key.replace(/([A-Z])/g, "_$1").toUpperCase()
          stack.push([[...path, formattedKey], subValue])
        }
      } else {
        const name = `${prefix}_${path.join("_")}`
        if (isSecret(value)) {
          variables.secrets[name] = value
        } else if (isParameter(value)) {
          variables.parameters[name] = value
        } else {
          variables.strings[name] = value.toString()
        }
      }
    }
    return variables
  }
}
