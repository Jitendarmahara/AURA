import type { Session } from "@aura/protocol";
export class SessionManager {
  private sessions = new Map<string, Session>();

  create(): Session {
    const session: Session = {
      sessionId: crypto.randomUUID(),
      createdAt: Date.now(),
      state: "new",
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
