export type BookingStatus = "confirmed" | "cancelled" | "committed";
export type BookingKind = "movie" | "train";

export type Booking = {
  id: string;
  kind: BookingKind;
  status: BookingStatus;
  createdAt: number;
  summary: string;
  details: Record<string, unknown>;
};

export type IdGen = () => string;

export class BookingStore {
  private bookings = new Map<string, Booking>();
  private order: string[] = [];

  constructor(private idGen: IdGen = () => crypto.randomUUID()) {}

  create(kind: BookingKind, summary: string, details: Record<string, unknown>): Booking {
    const booking: Booking = {
      id: this.idGen(),
      kind,
      status: "confirmed",
      createdAt: Date.now(),
      summary,
      details,
    };
    this.bookings.set(booking.id, booking);
    this.order.push(booking.id);
    return booking;
  }

  get(id: string): Booking | undefined {
    return this.bookings.get(id);
  }

  latest(kind?: BookingKind): Booking | undefined {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const b = this.bookings.get(this.order[i]!);
      if (!b) continue;
      if (kind && b.kind !== kind) continue;
      if (b.status === "confirmed") return b;
    }
    return undefined;
  }

  cancel(id: string): { ok: true; booking: Booking } | { ok: false; code: string; message: string } {
    const booking = this.bookings.get(id);
    if (!booking) return { ok: false, code: "not_found", message: `no booking ${id}` };
    if (booking.status === "cancelled")
      return { ok: false, code: "already_cancelled", message: `booking ${id} is already cancelled` };
    if (booking.status === "committed")
      return { ok: false, code: "committed", message: `booking ${id} is committed and can no longer be cancelled` };
    booking.status = "cancelled";
    return { ok: true, booking };
  }

  commit(id: string): { ok: true; booking: Booking } | { ok: false; code: string; message: string } {
    const booking = this.bookings.get(id);
    if (!booking) return { ok: false, code: "not_found", message: `no booking ${id}` };
    if (booking.status !== "confirmed")
      return { ok: false, code: "bad_state", message: `booking ${id} is ${booking.status}` };
    booking.status = "committed";
    return { ok: true, booking };
  }

  all(): Booking[] {
    return this.order.map((id) => this.bookings.get(id)!).filter(Boolean);
  }
}
