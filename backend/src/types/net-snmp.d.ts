// Minimal ambient type declarations for the `net-snmp` package (untyped upstream),
// covering only the API surface used by this project.
declare module 'net-snmp' {
  export interface VarBind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(oids: string[], callback: (error: Error | null, varbinds: VarBind[]) => void): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCallback: (varbinds: VarBind[]) => void,
      doneCallback: (error: Error | null) => void,
    ): void;
    close(): void;
  }

  export interface Receiver {
    close(): void;
  }

  export interface SessionOptions {
    port?: number;
    retries?: number;
    timeout?: number;
    version?: number;
  }

  export interface V3User {
    name: string;
    level: number;
    authProtocol?: number;
    authKey?: string;
    privProtocol?: number;
    privKey?: string;
  }

  export interface ReceiverOptions {
    port?: number;
    disableAuthorization?: boolean;
    transport?: string;
  }

  export const Version1: number;
  export const Version2c: number;
  export const AuthProtocols: { md5: number; sha: number };
  export const PrivProtocols: { des: number; aes: number };
  export const SecurityLevel: { noAuthNoPriv: number; authNoPriv: number; authPriv: number };

  export function createSession(target: string, community: string, options?: SessionOptions): Session;
  export function createV3Session(target: string, user: V3User, options?: SessionOptions): Session;
  export function createReceiver(
    options: ReceiverOptions,
    callback: (error: Error | null, notification: unknown) => void,
  ): Receiver;
  export function isVarbindError(varbind: VarBind): boolean;
}
