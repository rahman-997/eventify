import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Gauge,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  Trash2,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from "lucide-react";

type Role = "ATTENDEE" | "ORGANIZER" | "ADMIN";
type User = { id: string; email: string; name: string; role: Role; createdAt?: string };
type EventItem = {
  id: string;
  title: string;
  description: string;
  venue: string;
  startsAt: string;
  capacity: number;
  priceCents: number;
  organizerId: string;
  createdAt: string;
  confirmedBookings?: number;
  remainingSeats?: number;
  soldOut?: boolean;
};
type EventPage = { data: EventItem[]; page: number; limit: number; total: number };
type Booking = {
  id: string;
  userId: string;
  eventId: string;
  status: "CONFIRMED" | "CANCELLED" | "WAITLISTED";
  createdAt: string;
  event?: Pick<EventItem, "id" | "title" | "venue" | "startsAt" | "priceCents" | "capacity" | "organizerId">;
};
type EventStats = {
  eventId: string;
  capacity: number;
  confirmed: number;
  cancelled: number;
  waitlisted: number;
  remainingSeats: number;
  occupancyRate: number;
  grossRevenueCents: number;
};
type AuthMode = "login" | "signup";

const API = "/api";

async function parseResponse(response: Response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const candidate = body as { error?: { message?: string } | string; message?: string };
    if (typeof candidate.error === "string") return candidate.error;
    if (candidate.error && typeof candidate.error === "object" && candidate.error.message) return candidate.error.message;
    if (candidate.message) return candidate.message;
  }
  return fallback;
}

function money(cents: number) {
  return cents === 0 ? "Free" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(value));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function AppV2() {
  const eventsRequest = useRef<AbortController | null>(null);
  const [events, setEvents] = useState<EventPage>({ data: [], page: 1, limit: 9, total: 0 });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [myEvents, setMyEvents] = useState<EventItem[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => () => eventsRequest.current?.abort(), []);

  const canOrganize = user?.role === "ORGANIZER" || user?.role === "ADMIN";
  const pages = Math.max(1, Math.ceil(events.total / events.limit));

  const summary = useMemo(() => {
    const upcoming = events.data.filter((item) => new Date(item.startsAt).getTime() > Date.now()).length;
    const openSeats = events.data.reduce((total, item) => total + Math.max(0, item.remainingSeats ?? item.capacity), 0);
    const free = events.data.filter((item) => item.priceCents === 0).length;
    return { upcoming, openSeats, free };
  }, [events]);

  async function requestWithToken(path: string, init: RequestInit = {}, token: string | null = accessToken) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${API}${path}`, { ...init, headers, credentials: "include" });
    return { response, body: await parseResponse(response) };
  }

  async function refreshSession(): Promise<string | null> {
    try {
      const response = await fetch(`${API}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      const body = await parseResponse(response);
      if (!response.ok || !body?.accessToken) {
        setAccessToken(null);
        setUser(null);
        return null;
      }
      const token = body.accessToken as string;
      setAccessToken(token);
      const me = await requestWithToken("/v1/auth/me", {}, token);
      if (me.response.ok) setUser(me.body);
      return token;
    } catch {
      return null;
    }
  }

  async function request(path: string, init: RequestInit = {}, retry = true) {
    const first = await requestWithToken(path, init);
    if (first.response.status !== 401 || !retry) return first;
    const fresh = await refreshSession();
    if (!fresh) return first;
    return requestWithToken(path, init, fresh);
  }

  async function loadEvents(nextPage = page) {
    eventsRequest.current?.abort();
    const controller = new AbortController();
    eventsRequest.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "9" });
      if (query.trim()) params.set("q", query.trim());
      if (venue.trim()) params.set("venue", venue.trim());
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
      const response = await fetch(`${API}/v1/events?${params}`, { credentials: "include", signal: controller.signal });
      const body = await parseResponse(response);
      if (!response.ok) throw new Error(messageFrom(body, "Could not load events"));
      if (!controller.signal.aborted) setEvents(body);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not load events");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function loadDashboard(token = accessToken, account = user) {
    if (!token || !account) return;
    const bookings = await requestWithToken("/v1/bookings/mine", {}, token);
    if (bookings.response.ok) setMyBookings(bookings.body);
    if (account.role === "ORGANIZER" || account.role === "ADMIN") {
      const organized = await requestWithToken("/v1/events/mine", {}, token);
      if (organized.response.ok) setMyEvents(organized.body);
    }
  }

  useEffect(() => {
    void (async () => {
      await loadEvents(1);
      const token = await refreshSession();
      if (token) {
        const me = await requestWithToken("/v1/auth/me", {}, token);
        if (me.response.ok) {
          setUser(me.body);
          await loadDashboard(token, me.body);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page !== events.page) void loadEvents(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function handleAuth(input: { email: string; password: string; name?: string }) {
    const endpoint = authMode === "signup" ? "/v1/auth/signup" : "/v1/auth/login";
    const response = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    const body = await parseResponse(response);
    if (!response.ok) throw new Error(messageFrom(body, "Authentication failed"));
    setAccessToken(body.accessToken);
    setUser(body.user);
    setAuthMode(null);
    setNotice(`Welcome ${body.user.name}.`);
    await loadDashboard(body.accessToken, body.user);
  }

  async function signOut() {
    try {
      await requestWithToken("/v1/auth/logout", { method: "POST", body: "{}" });
    } finally {
      setAccessToken(null);
      setUser(null);
      setMyBookings([]);
      setMyEvents([]);
      setStats(null);
      setNotice("Signed out securely.");
    }
  }

  async function openEvent(item: EventItem) {
    const response = await fetch(`${API}/v1/events/${item.id}`, { credentials: "include" });
    const body = await parseResponse(response);
    setSelected(response.ok ? body : item);
  }

  async function createBooking(eventId: string) {
    if (!user) {
      setAuthMode("login");
      return;
    }
    const { response, body } = await request("/v1/bookings", { method: "POST", body: JSON.stringify({ eventId }) });
    if (!response.ok) {
      setNotice(messageFrom(body, "Booking failed"));
      return;
    }
    setNotice("Booking confirmed 🎟️");
    await Promise.all([loadDashboard(), loadEvents(page)]);
    if (selected) await openEvent(selected);
  }

  async function cancelBooking(booking: Booking) {
    const { response, body } = await request(`/v1/bookings/${booking.id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice(messageFrom(body, "Could not cancel booking"));
      return;
    }
    setNotice("Booking cancelled.");
    await Promise.all([loadDashboard(), loadEvents(page)]);
  }

  async function createEvent(input: Omit<EventItem, "id" | "organizerId" | "createdAt" | "confirmedBookings" | "remainingSeats" | "soldOut">) {
    const { response, body } = await request("/v1/events", { method: "POST", body: JSON.stringify(input) });
    if (!response.ok) throw new Error(messageFrom(body, "Could not create event"));
    setCreateOpen(false);
    setNotice(`“${body.title}” is live.`);
    setPage(1);
    await Promise.all([loadEvents(1), loadDashboard()]);
  }

  async function deleteEvent(item: EventItem) {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    const { response, body } = await request(`/v1/events/${item.id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice(messageFrom(body, "Could not delete event"));
      return;
    }
    setSelected(null);
    setNotice(`“${item.title}” deleted.`);
    await Promise.all([loadEvents(page), loadDashboard()]);
  }

  async function loadStats(eventId: string) {
    setStatsLoading(true);
    setStats(null);
    const { response, body } = await request(`/v1/events/${eventId}/stats`);
    if (response.ok) setStats(body);
    else setNotice(messageFrom(body, "Could not load event analytics"));
    setStatsLoading(false);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    void loadEvents(1);
  }

  function clearFilters() {
    setQuery("");
    setVenue("");
    setFrom("");
    setTo("");
    setPage(1);
    setTimeout(() => void loadEvents(1), 0);
  }

  return (
    <div className="v2-shell">
      <header className="v2-nav">
        <a className="v2-brand" href="#top"><span><Sparkles size={18} /></span>Eventify</a>
        <nav className={mobileNav ? "v2-links open" : "v2-links"}>
          <a href="#events" onClick={() => setMobileNav(false)}>Discover</a>
          <a href="#dashboard" onClick={() => setMobileNav(false)}>Dashboard</a>
          <a href="#platform" onClick={() => setMobileNav(false)}>Platform</a>
        </nav>
        <div className="v2-auth">
          {user ? (
            <>
              <a className="profile-pill" href="#dashboard"><CircleUserRound size={17} /><span>{user.name}</span><b>{user.role}</b></a>
              <button className="icon-text" onClick={() => void signOut()}><LogOut size={17} /><span>Sign out</span></button>
            </>
          ) : (
            <>
              <button className="icon-text" onClick={() => setAuthMode("login")}><LogIn size={17} /><span>Log in</span></button>
              <button className="v2-primary small" onClick={() => setAuthMode("signup")}>Join Eventify</button>
            </>
          )}
          <button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNav((value) => !value)}><Menu size={20} /></button>
        </div>
      </header>

      <main id="top">
        <section className="v2-hero">
          <div className="hero-copy-v2">
            <div className="v2-kicker"><span className="live-dot" />Live event marketplace</div>
            <h1>Find your next <em>great night out.</em></h1>
            <p>Search local experiences, see live availability, book securely, and manage every ticket from one polished workspace.</p>
            <div className="hero-cta-v2">
              <a className="v2-primary" href="#events">Explore events <ArrowRight size={18} /></a>
              {canOrganize ? <button className="v2-secondary" onClick={() => setCreateOpen(true)}><Plus size={18} />Create event</button> : <a className="v2-secondary" href="#platform"><ShieldCheck size={18} />How it works</a>}
            </div>
            <div className="hero-proof">
              <span><CheckCircle2 size={16} />Live seat counts</span>
              <span><CheckCircle2 size={16} />Secure sessions</span>
              <span><CheckCircle2 size={16} />Organizer analytics</span>
            </div>
          </div>
          <div className="hero-showcase">
            <div className="showcase-glow" />
            <div className="showcase-card main-card">
              <span className="showcase-label">Eventify pulse</span>
              <strong>{events.total}</strong>
              <small>events in the catalog</small>
              <div className="showcase-metrics">
                <div><CalendarDays size={18} /><b>{summary.upcoming}</b><span>upcoming here</span></div>
                <div><Users size={18} /><b>{summary.openSeats}</b><span>open seats</span></div>
                <div><WalletCards size={18} /><b>{summary.free}</b><span>free events</span></div>
              </div>
            </div>
            <div className="floating-card one"><TicketCheck size={18} /><div><b>Instant booking</b><span>Transactional & protected</span></div></div>
            <div className="floating-card two"><TrendingUp size={18} /><div><b>Live insights</b><span>For organizers</span></div></div>
          </div>
        </section>

        {notice && <div className="v2-notice"><CheckCircle2 size={18} /><span>{notice}</span><button onClick={() => setNotice(null)}><X size={17} /></button></div>}

        <section className="discover-section" id="events">
          <div className="v2-section-title">
            <div><span className="v2-kicker muted">Discover what’s happening</span><h2>Events worth showing up for</h2></div>
            <span className="catalog-count">{events.total} event{events.total === 1 ? "" : "s"}</span>
          </div>

          <form className="search-panel" onSubmit={applyFilters}>
            <label className="search-main"><Search size={19} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events, venues, experiences…" /></label>
            <label><MapPin size={18} /><input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue" /></label>
            <label><CalendarDays size={18} /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
            <label><CalendarDays size={18} /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
            <button className="v2-primary search-button" type="submit">Search</button>
            {(query || venue || from || to) && <button className="clear-filters" type="button" onClick={clearFilters}>Clear</button>}
          </form>

          {loading ? (
            <div className="v2-grid">{Array.from({ length: 6 }).map((_, index) => <div className="v2-skeleton" key={index} />)}</div>
          ) : events.data.length === 0 ? (
            <div className="v2-empty"><Search size={34} /><h3>No matching events</h3><p>Try a broader search or clear the current filters.</p><button className="v2-secondary small" onClick={clearFilters}>Reset search</button></div>
          ) : (
            <div className="v2-grid">
              {events.data.map((item, index) => <EventCard key={item.id} item={item} index={index} onOpen={() => void openEvent(item)} />)}
            </div>
          )}

          <div className="v2-pagination">
            <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} />Previous</button>
            <span><b>{page}</b> / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next<ChevronRight size={17} /></button>
          </div>
        </section>

        <section className="dashboard-v2" id="dashboard">
          <div className="v2-section-title light">
            <div><span className="v2-kicker">Your command center</span><h2>{user ? `Welcome back, ${user.name.split(" ")[0]}` : "Everything after discovery, in one place"}</h2></div>
            {canOrganize && <button className="v2-primary small" onClick={() => setCreateOpen(true)}><Plus size={16} />New event</button>}
          </div>

          {!user ? (
            <div className="signed-out-dashboard">
              <div><ShieldCheck size={30} /><h3>Your tickets stay tied to your account.</h3><p>Sign in to view booking history, cancel tickets, and unlock organizer tools when your role allows it.</p></div>
              <button className="v2-primary" onClick={() => setAuthMode("login")}>Open my dashboard <ArrowRight size={18} /></button>
            </div>
          ) : (
            <div className="dashboard-layout">
              <div className="dashboard-column">
                <div className="dashboard-heading"><div><TicketCheck size={20} /><h3>My bookings</h3></div><span>{myBookings.length}</span></div>
                {myBookings.length === 0 ? <div className="dashboard-empty"><p>No bookings yet. Pick something from the catalog above.</p><a href="#events">Browse events <ArrowRight size={15} /></a></div> : (
                  <div className="booking-list">
                    {myBookings.map((booking) => <BookingRow key={booking.id} booking={booking} onCancel={() => void cancelBooking(booking)} />)}
                  </div>
                )}
              </div>

              {canOrganize ? (
                <div className="dashboard-column organizer-column">
                  <div className="dashboard-heading"><div><BarChart3 size={20} /><h3>Organizer studio</h3></div><span>{myEvents.length}</span></div>
                  {myEvents.length === 0 ? <div className="dashboard-empty"><p>You have not published an event yet.</p><button onClick={() => setCreateOpen(true)}>Create your first event <ArrowRight size={15} /></button></div> : (
                    <div className="organizer-list">
                      {myEvents.map((item) => <OrganizerRow key={item.id} item={item} onStats={() => void loadStats(item.id)} onOpen={() => void openEvent(item)} />)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="dashboard-column perks-column">
                  <div className="dashboard-heading"><div><Gauge size={20} /><h3>Account overview</h3></div></div>
                  <div className="account-summary">
                    <div><span>Role</span><b>{user.role}</b></div>
                    <div><span>Email</span><b>{user.email}</b></div>
                    <div><span>Confirmed</span><b>{myBookings.filter((item) => item.status === "CONFIRMED").length}</b></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {(statsLoading || stats) && <StatsPanel loading={statsLoading} stats={stats} onClose={() => setStats(null)} />}
        </section>

        <section className="platform-v2" id="platform">
          <div className="platform-copy"><span className="v2-kicker muted">Built like a real product</span><h2>Fast on the surface. Strict underneath.</h2><p>Eventify pairs a polished customer experience with server-enforced authentication, ownership, role checks, transactional booking rules, and a production PostgreSQL database.</p></div>
          <div className="platform-grid">
            <div><ShieldCheck size={22} /><h3>Secure sessions</h3><p>Rotating refresh tokens, HttpOnly cookies, real logout, and protected API actions.</p></div>
            <div><TicketCheck size={22} /><h3>Booking integrity</h3><p>Serializable booking transactions prevent overselling and duplicate reservations.</p></div>
            <div><BarChart3 size={22} /><h3>Organizer insight</h3><p>Live occupancy, confirmed tickets, cancellations, remaining seats, and gross revenue.</p></div>
          </div>
        </section>
      </main>

      <footer className="v2-footer"><a className="v2-brand" href="#top"><span><Sparkles size={16} /></span>Eventify</a><p>Discover · Book · Organize</p><span>Production experience v0.6</span></footer>

      {authMode && <AuthModal mode={authMode} onMode={setAuthMode} onClose={() => setAuthMode(null)} onSubmit={handleAuth} />}
      {createOpen && <CreateEventModal onClose={() => setCreateOpen(false)} onSubmit={createEvent} />}
      {selected && <EventDetailModal item={selected} user={user} canManage={Boolean(user && (user.role === "ADMIN" || user.id === selected.organizerId))} onClose={() => setSelected(null)} onBook={() => void createBooking(selected.id)} onDelete={() => void deleteEvent(selected)} />}
    </div>
  );
}

function EventCard({ item, index, onOpen }: { item: EventItem; index: number; onOpen: () => void }) {
  const seats = item.remainingSeats ?? item.capacity;
  const soldOut = item.soldOut ?? seats <= 0;
  return <article className="v2-event-card" onClick={onOpen}>
    <div className={`v2-art art-${index % 6}`}>
      <div className="date-tile"><b>{new Date(item.startsAt).getDate()}</b><span>{new Date(item.startsAt).toLocaleDateString(undefined, { month: "short" })}</span></div>
      <span className={soldOut ? "availability sold" : "availability"}>{soldOut ? "Sold out" : `${seats} seats left`}</span>
      <div className="art-orbit"><Sparkles size={27} /></div>
    </div>
    <div className="v2-event-body">
      <div className="event-eyeline"><span><MapPin size={14} />{item.venue}</span><span><Clock3 size={14} />{timeLabel(item.startsAt)}</span></div>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <div className="event-bottom"><div><b>{money(item.priceCents)}</b><span>{dateLabel(item.startsAt)}</span></div><button aria-label={`View ${item.title}`}><ArrowRight size={18} /></button></div>
    </div>
  </article>;
}

function BookingRow({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  const event = booking.event;
  return <div className="booking-row">
    <div className="booking-icon"><TicketCheck size={18} /></div>
    <div className="booking-copy"><b>{event?.title ?? "Event booking"}</b><span>{event ? `${dateLabel(event.startsAt)} · ${event.venue}` : booking.eventId}</span></div>
    <span className={`status-badge ${booking.status.toLowerCase()}`}>{booking.status}</span>
    {booking.status !== "CANCELLED" && <button className="row-action danger" onClick={onCancel}>Cancel</button>}
  </div>;
}

function OrganizerRow({ item, onStats, onOpen }: { item: EventItem; onStats: () => void; onOpen: () => void }) {
  const confirmed = item.confirmedBookings ?? 0;
  const occupancy = item.capacity > 0 ? Math.round((confirmed / item.capacity) * 100) : 0;
  return <div className="organizer-row">
    <div className="organizer-main"><b>{item.title}</b><span>{dateLabel(item.startsAt)} · {item.venue}</span></div>
    <div className="occupancy"><span><i style={{ width: `${Math.min(100, occupancy)}%` }} /></span><b>{occupancy}%</b></div>
    <button className="row-action" onClick={onStats}>Analytics</button>
    <button className="row-action" onClick={onOpen}>Open</button>
  </div>;
}

function StatsPanel({ loading, stats, onClose }: { loading: boolean; stats: EventStats | null; onClose: () => void }) {
  return <div className="stats-panel">
    <div className="stats-head"><div><BarChart3 size={20} /><b>Event analytics</b></div><button onClick={onClose}><X size={18} /></button></div>
    {loading || !stats ? <div className="stats-loading">Loading live analytics…</div> : <div className="stats-grid">
      <div><span>Confirmed</span><b>{stats.confirmed}</b></div>
      <div><span>Occupancy</span><b>{Math.round(stats.occupancyRate * 100)}%</b></div>
      <div><span>Seats left</span><b>{stats.remainingSeats}</b></div>
      <div><span>Gross revenue</span><b>{money(stats.grossRevenueCents)}</b></div>
      <div><span>Cancelled</span><b>{stats.cancelled}</b></div>
      <div><span>Waitlisted</span><b>{stats.waitlisted}</b></div>
    </div>}
  </div>;
}

function AuthModal({ mode, onMode, onClose, onSubmit }: { mode: AuthMode; onMode: (mode: AuthMode) => void; onClose: () => void; onSubmit: (input: { email: string; password: string; name?: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({ email, password, ...(mode === "signup" ? { name } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return <div className="v2-modal-backdrop" onMouseDown={onClose}><div className="v2-modal auth-v2" onMouseDown={(e) => e.stopPropagation()}>
    <button className="modal-x" onClick={onClose}><X size={19} /></button>
    <div className="modal-brand"><span><Sparkles size={20} /></span>Eventify</div>
    <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
    <p>{mode === "login" ? "Sign in to manage tickets and your Eventify dashboard." : "Join as an attendee and start booking experiences in seconds."}</p>
    <form className="v2-form" onSubmit={submit}>
      {mode === "signup" && <label>Name<input required minLength={1} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>}
      <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <label>Password<input required type="password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
      {error && <div className="v2-form-error">{error}</div>}
      <button className="v2-primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
    </form>
    <button className="auth-switch" onClick={() => onMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New to Eventify? Create an account" : "Already have an account? Log in"}</button>
  </div></div>;
}

function CreateEventModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: Omit<EventItem, "id" | "organizerId" | "createdAt" | "confirmedBookings" | "remainingSeats" | "soldOut">) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [capacity, setCapacity] = useState(80);
  const [price, setPrice] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({ title, description, venue, startsAt: new Date(startsAt).toISOString(), capacity, priceCents: Math.round(price * 100) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
    } finally {
      setBusy(false);
    }
  }

  return <div className="v2-modal-backdrop" onMouseDown={onClose}><div className="v2-modal create-v2" onMouseDown={(e) => e.stopPropagation()}>
    <button className="modal-x" onClick={onClose}><X size={19} /></button>
    <span className="v2-kicker muted">Organizer studio</span><h2>Publish a new event</h2><p>Fill the essentials. Availability and analytics update automatically after launch.</p>
    <form className="v2-form form-grid" onSubmit={submit}>
      <label className="span-2">Title<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Night Market Sessions" /></label>
      <label className="span-2">Description<textarea required rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell guests what makes this event special…" /></label>
      <label>Venue<input required value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
      <label>Date & time<input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
      <label>Capacity<input required type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
      <label>Price (USD)<input required type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
      {error && <div className="v2-form-error span-2">{error}</div>}
      <button className="v2-primary full span-2" disabled={busy}>{busy ? "Publishing…" : "Publish event"}</button>
    </form>
  </div></div>;
}

function EventDetailModal({ item, user, canManage, onClose, onBook, onDelete }: { item: EventItem; user: User | null; canManage: boolean; onClose: () => void; onBook: () => void; onDelete: () => void }) {
  const seats = item.remainingSeats ?? item.capacity;
  const soldOut = item.soldOut ?? seats <= 0;
  const past = new Date(item.startsAt).getTime() <= Date.now();
  return <div className="v2-modal-backdrop" onMouseDown={onClose}><div className="v2-modal event-detail-v2" onMouseDown={(e) => e.stopPropagation()}>
    <button className="modal-x" onClick={onClose}><X size={19} /></button>
    <div className="detail-art"><div className="detail-date"><b>{new Date(item.startsAt).getDate()}</b><span>{new Date(item.startsAt).toLocaleDateString(undefined, { month: "long" })}</span></div><Sparkles size={38} /></div>
    <div className="detail-content">
      <div className="detail-badges"><span><MapPin size={14} />{item.venue}</span><span className={soldOut ? "sold" : ""}><Users size={14} />{soldOut ? "Sold out" : `${seats} seats left`}</span></div>
      <h2>{item.title}</h2><p>{item.description}</p>
      <div className="detail-facts"><div><span>Date</span><b>{dateLabel(item.startsAt)}</b></div><div><span>Time</span><b>{timeLabel(item.startsAt)}</b></div><div><span>Price</span><b>{money(item.priceCents)}</b></div><div><span>Capacity</span><b>{item.capacity}</b></div></div>
      <div className="detail-actions">
        <button className="v2-primary" disabled={soldOut || past} onClick={onBook}>{past ? "Event started" : soldOut ? "Sold out" : user ? "Book this event" : "Log in to book"}<ArrowRight size={17} /></button>
        {canManage && <button className="delete-button" onClick={onDelete}><Trash2 size={17} />Delete event</button>}
      </div>
    </div>
  </div></div>;
}
