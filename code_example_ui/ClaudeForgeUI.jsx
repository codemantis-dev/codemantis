import { useState, useEffect, useRef, useCallback } from "react";

// ─── Mock Data ───────────────────────────────────────────────

const mockSessions = [
  { id: 1, name: "Auth refactor", project: "juliam-api", active: true, icon: "⬡" },
  { id: 2, name: "RAG pipeline", project: "insurance-rag", active: false, icon: "◈" },
  { id: 3, name: "Edge functions", project: "contentscaler", active: false, icon: "△" },
];

const mockMessages = [
  { id: 1, role: "user", content: "Look at the auth module and suggest how to refactor it into separate concerns", ts: "14:23" },
  {
    id: 2, role: "assistant", ts: "14:23",
    content: "I've analyzed your auth module. The current structure mixes **session management**, **JWT validation**, and **role-based access control** in a single file.\n\nI'd recommend splitting into three focused modules:\n\n• **session.ts** — Session lifecycle management\n• **jwt.ts** — Token creation and validation\n• **rbac.ts** — Permission guards and role checks\n• **middleware.ts** — Thin Express middleware layer\n• **index.ts** — Public API re-exports\n\nWant me to perform the refactor? I'll create the new files and update all imports across the codebase.",
    activityRef: [0, 1, 2, 3],
  },
  { id: 3, role: "user", content: "Yes, go ahead with the refactor", ts: "14:24" },
  {
    id: 4, role: "assistant", ts: "14:24", streaming: true,
    content: "I've created the three new modules and updated the imports in middleware.ts and index.ts. Running type check now to verify everything compiles cleanly...",
    activityRef: [4, 5, 6, 7, 8, 9],
  },
];

// Activity feed — everything Claude does to the codebase
const mockActivity = [
  { id: 0, type: "tool", tool: "Glob", args: "src/**/*.ts", status: "done", ms: 310, ts: "14:23:01", msgId: 2, detail: "Found 12 files" },
  { id: 1, type: "tool", tool: "Read", args: "src/auth/index.ts", status: "done", ms: 120, ts: "14:23:02", msgId: 2, detail: "186 lines" },
  { id: 2, type: "tool", tool: "Read", args: "src/auth/middleware.ts", status: "done", ms: 95, ts: "14:23:02", msgId: 2, detail: "94 lines" },
  { id: 3, type: "tool", tool: "Grep", args: '"jwt" in src/', status: "done", ms: 220, ts: "14:23:03", msgId: 2, detail: "7 matches" },
  { id: 4, type: "write", file: "src/auth/session.ts", status: "done", ms: 1200, ts: "14:24:01", msgId: 4, lines: 42 },
  { id: 5, type: "write", file: "src/auth/jwt.ts", status: "done", ms: 940, ts: "14:24:02", msgId: 4, lines: 38 },
  { id: 6, type: "write", file: "src/auth/rbac.ts", status: "done", ms: 810, ts: "14:24:03", msgId: 4, lines: 29 },
  { id: 7, type: "edit", file: "src/auth/middleware.ts", status: "done", ms: 580, ts: "14:24:04", msgId: 4, changes: "+8 -4" },
  { id: 8, type: "edit", file: "src/auth/index.ts", status: "done", ms: 310, ts: "14:24:05", msgId: 4, changes: "+6 -12" },
  { id: 9, type: "bash", cmd: "npx tsc --noEmit", status: "pending", ts: "14:24:06", msgId: 4 },
];

const mockFiles = [
  { name: "src", type: "dir", open: true, children: [
    { name: "auth", type: "dir", open: true, children: [
      { name: "session.ts", type: "file", mod: true },
      { name: "jwt.ts", type: "file", mod: true },
      { name: "rbac.ts", type: "file", mod: true },
      { name: "middleware.ts", type: "file" },
      { name: "index.ts", type: "file" },
    ]},
    { name: "api", type: "dir", children: [
      { name: "routes.ts", type: "file" },
      { name: "handlers.ts", type: "file" },
    ]},
    { name: "db", type: "dir", children: [{ name: "schema.ts", type: "file" }] },
    { name: "app.ts", type: "file" },
  ]},
  { name: "package.json", type: "file" },
  { name: "CLAUDE.md", type: "file", special: true },
  { name: "tsconfig.json", type: "file" },
];

const mockFileContent = [
  "// src/auth/jwt.ts",
  "// Token creation & validation module",
  "",
  "const SECRET = new TextEncoder().encode(",
  "  process.env.JWT_SECRET ?? 'dev-secret-change-me'",
  ");",
  "",
  "interface TokenPayload {",
  "  userId: string;",
  "  role: 'admin' | 'broker' | 'viewer';",
  "  tenantId: string;",
  "  iat?: number;",
  "  exp?: number;",
  "}",
  "",
  "async function createToken(",
  "  payload: Omit<TokenPayload, 'iat' | 'exp'>",
  "): Promise<string> {",
  "  const header = { alg: 'HS256' };",
  "  const now = Math.floor(Date.now() / 1000);",
  "  const claims = {",
  "    ...payload,",
  "    iat: now,",
  "    exp: now + 8 * 60 * 60, // 8 hours",
  "  };",
  "  return signJWT(claims, header, SECRET);",
  "}",
  "",
  "async function verifyToken(",
  "  token: string",
  "): Promise<TokenPayload> {",
  "  const { payload } = await jwtVerify(token, SECRET);",
  "  return payload as TokenPayload;",
  "}",
  "",
  "function extractBearerToken(",
  "  header: string | undefined",
  "): string | null {",
  "  if (!header?.startsWith('Bearer ')) return null;",
  "  return header.slice(7);",
  "}",
].join("\n");

const mockDiff = [
  { type: "header", text: "src/auth/middleware.ts" },
  { type: "info", text: "@@ -1,8 +1,6 @@" },
  { type: "del", text: "const { verify, sign, createSession } = authIndex;" },
  { type: "del", text: "const { checkRole } = authIndex;" },
  { type: "add", text: "const { verifyToken } = jwtModule;" },
  { type: "add", text: "const { checkPermission } = rbacModule;" },
  { type: "add", text: "const { getSession } = sessionModule;" },
  { type: "ctx", text: "" },
  { type: "ctx", text: "function authMiddleware(req, res, next) {" },
  { type: "del", text: "  const token = req.headers.authorization;" },
  { type: "del", text: "  const payload = verify(token);" },
  { type: "add", text: "  const bearer = extractBearerToken(req.headers.authorization);" },
  { type: "add", text: "  const payload = await verifyToken(bearer);" },
  { type: "ctx", text: "  req.user = payload;" },
  { type: "ctx", text: "  next();" },
];

const mockTerminals = {
  1: {
    name: "dev server",
    running: true,
    lines: [
      { type: "cmd", text: "$ npm run dev" },
      { type: "out", text: "" },
      { type: "info", text: "> juliam-api@0.4.2 dev" },
      { type: "info", text: "> tsx watch src/app.ts" },
      { type: "out", text: "" },
      { type: "success", text: "  \u2713 Server running on http://localhost:3001" },
      { type: "success", text: "  \u2713 Supabase connected (eu-central-1)" },
      { type: "success", text: "  \u2713 3 MCP servers registered" },
      { type: "out", text: "" },
      { type: "dim", text: "[14:24:01] Watching for file changes..." },
      { type: "dim", text: "[14:24:18] File change: src/auth/session.ts" },
      { type: "info", text: "[14:24:18] Restarting..." },
      { type: "success", text: "  \u2713 Server running on http://localhost:3001" },
    ],
  },
  2: {
    name: "tests",
    running: false,
    lines: [
      { type: "cmd", text: "$ npm test" },
      { type: "out", text: "" },
      { type: "info", text: " PASS  src/auth/jwt.test.ts" },
      { type: "success", text: "  \u2713 createToken returns valid JWT (12ms)" },
      { type: "success", text: "  \u2713 verifyToken decodes payload (8ms)" },
      { type: "success", text: "  \u2713 extractBearerToken strips prefix (2ms)" },
      { type: "out", text: "" },
      { type: "info", text: " PASS  src/auth/rbac.test.ts" },
      { type: "success", text: "  \u2713 admin can access all routes (3ms)" },
      { type: "success", text: "  \u2713 broker restricted to own clients (5ms)" },
      { type: "out", text: "" },
      { type: "info", text: "Tests:  5 passed, 5 total" },
      { type: "info", text: "Time:   1.24s" },
      { type: "out", text: "" },
      { type: "cmd", text: "$ " },
    ],
  },
  3: {
    name: "git",
    running: false,
    lines: [
      { type: "cmd", text: "$ git status" },
      { type: "out", text: "" },
      { type: "info", text: "On branch feat/auth-refactor" },
      { type: "out", text: "" },
      { type: "success", text: "Changes to be committed:" },
      { type: "add", text: "  new file:   src/auth/session.ts" },
      { type: "add", text: "  new file:   src/auth/jwt.ts" },
      { type: "add", text: "  new file:   src/auth/rbac.ts" },
      { type: "out", text: "" },
      { type: "dim", text: "Changes not staged for commit:" },
      { type: "warn", text: "  modified:   src/auth/middleware.ts" },
      { type: "warn", text: "  modified:   src/auth/index.ts" },
      { type: "out", text: "" },
      { type: "cmd", text: "$ " },
    ],
  },
};

// ─── Constants ───────────────────────────────────────────────

const C = {
  bg: "#09090b", bgS: "rgba(255,255,255,0.02)", bgE: "rgba(255,255,255,0.04)",
  brd: "rgba(255,255,255,0.07)", brdL: "rgba(255,255,255,0.04)",
  t1: "#e4e4e7", t2: "#a1a1aa", t3: "#71717a", t4: "#52525b", t5: "#3f3f46",
  ac: "#7c3aed", acL: "#a78bfa", acD: "rgba(124,58,237,0.15)",
  g: "#4ade80", gD: "rgba(74,222,128,0.1)",
  y: "#fbbf24", yD: "rgba(251,191,36,0.1)",
  r: "#f87171", bl: "#60a5fa",
};
const TC = { Read: "#60a5fa", Write: "#34d399", Edit: "#fbbf24", Bash: "#c084fc", Glob: "#f472b6", Grep: "#fb923c" };
const MN = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";
const SN = "'SF Pro Display', 'Inter', -apple-system, sans-serif";

// ─── Micro Components ────────────────────────────────────────

const ToolBadge = ({ name }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 20, height: 20, borderRadius: 5, fontSize: 9, fontWeight: 700,
    backgroundColor: `${TC[name] || "#94a3b8"}18`, color: TC[name] || "#94a3b8",
  }}>{name.slice(0, 2).toUpperCase()}</span>
);

const Dot = ({ color, pulse }) => (
  <span style={{
    display: "inline-block", width: 6, height: 6, borderRadius: "50%",
    backgroundColor: color, animation: pulse ? "pulse 1.5s ease-in-out infinite" : "none",
  }} />
);

// ─── File Tree ───────────────────────────────────────────────

function FileTree({ files, depth = 0, onFileClick, selectedFile }) {
  const [open, setOpen] = useState(() => new Set(files.filter(f => f.open).map(f => f.name)));
  const toggle = name => setOpen(p => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n; });

  return (
    <div>{files.map(f => {
      const isDir = f.type === "dir", isOpen = open.has(f.name), isSel = selectedFile === f.name;
      return (
        <div key={f.name}>
          <div onClick={() => isDir ? toggle(f.name) : onFileClick?.(f)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "3px 8px",
            paddingLeft: depth * 14 + 8, cursor: "pointer", borderRadius: 6, fontSize: 12.5,
            color: f.special ? "#f59e0b" : f.mod ? C.g : C.t2,
            backgroundColor: isSel ? "rgba(124,58,237,0.12)" : "transparent", transition: "background-color 0.1s",
          }}
            onMouseEnter={e => { if (!isSel) e.currentTarget.style.backgroundColor = C.bgE; }}
            onMouseLeave={e => { if (!isSel) e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <span style={{ fontSize: 8, width: 10, textAlign: "center", color: C.t4 }}>{isDir ? (isOpen ? "▼" : "▶") : ""}</span>
            <span style={{ fontSize: 14, width: 16, textAlign: "center" }}>{isDir ? (isOpen ? "📂" : "📁") : f.special ? "📋" : "📄"}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            {f.mod && <span style={{ fontSize: 8, color: C.g, fontWeight: 700 }}>M</span>}
          </div>
          {isDir && isOpen && f.children && <FileTree files={f.children} depth={depth + 1} onFileClick={onFileClick} selectedFile={selectedFile} />}
        </div>
      );
    })}</div>
  );
}

// ─── Terminal ────────────────────────────────────────────────

function Terminal({ lines, input, setInput }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  const lc = { cmd: C.t1, out: C.t3, info: C.bl, success: C.g, dim: C.t4, err: C.r, warn: C.y, add: C.g };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: MN, fontSize: 12, lineHeight: 1.7 }}>
      <div ref={ref} style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: lc[l.type] || C.t3, whiteSpace: "pre-wrap", minHeight: l.text === "" ? 12 : undefined }}>{l.text}</div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${C.brd}`, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: C.ac, fontWeight: 700, fontSize: 13 }}>❯</span>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type command..."
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.t1, fontFamily: MN, fontSize: 12 }}
          onKeyDown={e => { if (e.key === "Enter") setInput(""); }}
        />
      </div>
    </div>
  );
}

// ─── File Viewer ─────────────────────────────────────────────

function FileViewer({ filename, content }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.brd}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: C.t3 }}>{filename || "No file selected"}</span>
        {filename && <span style={{ marginLeft: "auto", fontSize: 10, color: C.t4, padding: "2px 6px", borderRadius: 4, backgroundColor: C.bgE }}>{filename.split(".").pop()?.toUpperCase()}</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {content ? content.split("\n").map((line, i) => (
          <div key={i} style={{ display: "flex", fontFamily: MN, fontSize: 12, lineHeight: 1.7 }}>
            <span style={{ width: 48, textAlign: "right", paddingRight: 14, color: C.t5, userSelect: "none", flexShrink: 0 }}>{i + 1}</span>
            <span style={{ color: C.t2, whiteSpace: "pre" }}>{line}</span>
          </div>
        )) : <div style={{ padding: 40, textAlign: "center", color: C.t4, fontSize: 13 }}>Click a file in the sidebar to view</div>}
      </div>
    </div>
  );
}

// ─── Diff Viewer ─────────────────────────────────────────────

function DiffViewer({ hunks }) {
  const c = { header: C.acL, info: C.bl, del: C.r, add: C.g, ctx: C.t4 };
  const bg = { del: "rgba(248,113,113,0.06)", add: "rgba(74,222,128,0.06)" };
  const px = { del: "−", add: "+", ctx: " " };
  return (
    <div style={{ height: "100%", overflowY: "auto", fontFamily: MN, fontSize: 12, lineHeight: 1.8 }}>
      {hunks.map((h, i) => (
        <div key={i} style={{
          display: "flex", padding: h.type === "header" ? "12px 14px 4px" : "0 14px",
          backgroundColor: bg[h.type] || "transparent",
          borderTop: h.type === "header" && i > 0 ? `1px solid ${C.brd}` : "none",
        }}>
          {h.type === "header" ? (
            <span style={{ fontWeight: 700, color: c.header, fontSize: 13, fontFamily: SN }}>{h.text}</span>
          ) : (
            <>
              <span style={{ width: 20, color: c[h.type], textAlign: "center", userSelect: "none", flexShrink: 0 }}>{px[h.type] || ""}</span>
              <span style={{ color: c[h.type], whiteSpace: "pre" }}>{h.text}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tool Approval ───────────────────────────────────────────

function Approval({ tool, onApprove, onDeny }) {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(12px)", zIndex: 50,
    }}>
      <div style={{
        borderRadius: 18, padding: 24, maxWidth: 400, width: "calc(100% - 32px)",
        backgroundColor: "#18181b", border: `1px solid ${C.brd}`, boxShadow: "0 25px 80px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(196,132,252,0.12)" }}>
            <ToolBadge name={tool.name} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.t1 }}>Approve Tool?</div>
            <div style={{ fontSize: 12, color: C.t3 }}>Claude wants to execute a command</div>
          </div>
        </div>
        <div style={{ borderRadius: 12, padding: 12, marginBottom: 18, backgroundColor: "rgba(0,0,0,0.35)", border: `1px solid ${C.brdL}` }}>
          <div style={{ fontSize: 10, color: C.t3, marginBottom: 4, fontWeight: 600, letterSpacing: "0.04em" }}>{tool.name.toUpperCase()}</div>
          <code style={{ fontSize: 13, color: "#c084fc", fontFamily: MN }}>{tool.args}</code>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onDeny} style={{ flex: 1, borderRadius: 12, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", backgroundColor: C.bgE, color: C.t2, border: `1px solid ${C.brd}` }}>Deny</button>
          <button onClick={onApprove} style={{ flex: 1, borderRadius: 12, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", background: `linear-gradient(135deg, ${C.ac}, #6d28d9)`, color: "#fff", border: "none" }}>Approve</button>
        </div>
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button onClick={onApprove} style={{ background: "none", border: "none", fontSize: 11, color: C.t4, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>
            Always allow {tool.name} for this session
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Feed ───────────────────────────────────────────

function ActivityFeed({ activities, onFileClick, onDiffClick }) {
  const typeIcon = { tool: C.bl, write: C.g, edit: C.y, bash: "#c084fc" };
  const typeLabel = { tool: "READ", write: "NEW", edit: "EDIT", bash: "BASH" };

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      {activities.map((a, i) => {
        const isLast = i === activities.length - 1;
        return (
          <div key={a.id} style={{
            display: "flex", gap: 10, padding: "8px 14px",
            borderBottom: `1px solid ${C.brdL}`,
            backgroundColor: a.status === "pending" ? "rgba(251,191,36,0.04)" : "transparent",
            cursor: (a.type === "write" || a.type === "edit") ? "pointer" : "default",
          }}
            onClick={() => {
              if (a.type === "write") onFileClick?.(a.file);
              if (a.type === "edit") onDiffClick?.();
            }}
            onMouseEnter={e => { if (a.type === "write" || a.type === "edit") e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = a.status === "pending" ? "rgba(251,191,36,0.04)" : "transparent"; }}
          >
            {/* Timeline dot + line */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20, flexShrink: 0, paddingTop: 4 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                backgroundColor: a.status === "pending" ? C.y : typeIcon[a.type],
                boxShadow: a.status === "pending" ? `0 0 8px ${C.y}44` : "none",
              }} />
              {!isLast && <div style={{ width: 1, flex: 1, backgroundColor: C.brdL, marginTop: 4 }} />}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                  color: a.status === "pending" ? C.y : typeIcon[a.type],
                  backgroundColor: `${a.status === "pending" ? C.y : typeIcon[a.type]}15`,
                  padding: "1px 5px", borderRadius: 3,
                }}>{typeLabel[a.type]}</span>
                <span style={{ fontSize: 10, color: C.t4 }}>{a.ts}</span>
                {a.status === "done" && a.ms && (
                  <span style={{ fontSize: 10, color: C.t4 }}>{a.ms}ms</span>
                )}
                {a.status === "pending" && (
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <Dot color={C.y} pulse />
                    <span style={{ fontSize: 10, color: C.y }}>running</span>
                  </span>
                )}
              </div>
              <div style={{ fontFamily: MN, fontSize: 12, color: C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.file || a.args || a.cmd}
              </div>
              {/* Detail line */}
              {a.type === "write" && a.lines && (
                <div style={{ fontSize: 10, color: C.g, marginTop: 2 }}>{"\u2713"} Created ({a.lines} lines) \u2014 click to view</div>
              )}
              {a.type === "edit" && a.changes && (
                <div style={{ fontSize: 10, color: C.y, marginTop: 2 }}>{a.changes} \u2014 click to view diff</div>
              )}
              {a.type === "tool" && a.detail && (
                <div style={{ fontSize: 10, color: C.t4, marginTop: 2 }}>{a.detail}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────

export default function ClaudeForgeUI() {
  const [input, setInput] = useState("");
  const [activeSession, setActiveSession] = useState(1);
  const [sidebarTab, setSidebarTab] = useState("files");
  const [rightTab, setRightTab] = useState("activity");
  const [selectedFile, setSelectedFile] = useState(null);
  const [showApproval, setShowApproval] = useState(true);
  const [termInput, setTermInput] = useState("");
  const [blink, setBlink] = useState(true);
  const [activeTerminal, setActiveTerminal] = useState(1);
  const [terminalIds, setTerminalIds] = useState([1, 2, 3]);
  const [nextTermId, setNextTermId] = useState(4);
  const [attachments, setAttachments] = useState([
    { id: 1, type: "image", name: "screenshot.png", size: "142 KB", preview: true },
    { id: 2, type: "file", name: "design-spec.pdf", size: "2.1 MB", preview: false },
  ]);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const chatRef = useRef(null);

  useEffect(() => { const t = setInterval(() => setBlink(b => !b), 530); return () => clearInterval(t); }, []);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, []);

  const handleFileClick = useCallback(f => { setSelectedFile(f.name); setRightTab("file"); }, []);

  return (
    <div style={{ height: "100vh", width: "100%", display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: C.bg, fontFamily: SN, color: C.t1, position: "relative" }}>

      {/* ═══ TITLE BAR + SESSION TABS ═══ */}
      <div style={{
        display: "flex", alignItems: "center", height: 46, flexShrink: 0,
        borderBottom: `1px solid ${C.brd}`, background: "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 16, paddingRight: 14, flexShrink: 0 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#28c840" }} />
        </div>

        <div style={{ display: "flex", alignItems: "stretch", flex: 1, gap: 1, height: "100%", paddingTop: 6 }}>
          {mockSessions.map(s => {
            const on = s.id === activeSession;
            return (
              <button key={s.id} onClick={() => setActiveSession(s.id)} style={{
                display: "flex", alignItems: "center", gap: 7, padding: "0 14px",
                borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", minWidth: 130, maxWidth: 220,
                backgroundColor: on ? "rgba(255,255,255,0.05)" : "transparent",
                borderTop: on ? `2px solid ${C.ac}` : "2px solid transparent",
                transition: "all 0.15s ease",
              }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.025)"; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <span style={{ fontSize: 13, color: on ? C.ac : C.t4 }}>{s.icon}</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, gap: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: on ? 600 : 400, color: on ? C.t1 : C.t3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{s.name}</span>
                  <span style={{ fontSize: 10, color: C.t4 }}>{s.project}</span>
                </div>
                {on && <Dot color={C.g} />}
                <span style={{ marginLeft: "auto", fontSize: 14, color: C.t5, lineHeight: 1, opacity: 0.5, paddingLeft: 4 }}>×</span>
              </button>
            );
          })}
          <button style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, border: "none", background: "none", cursor: "pointer", color: C.t4, fontSize: 16 }}>+</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 16, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: C.g, backgroundColor: C.gD }}>
            <Dot color={C.g} /> Pro
          </div>
          <span style={{ fontSize: 11, color: C.t5 }}>⌘K</span>
        </div>
      </div>

      {/* ═══ MAIN LAYOUT ═══ */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* ─── LEFT SIDEBAR ─── */}
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${C.brd}`, backgroundColor: C.bgS }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
            {["files", "git", "mcp"].map(tab => (
              <button key={tab} onClick={() => setSidebarTab(tab)} style={{
                flex: 1, padding: "9px 0", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.06em", backgroundColor: "transparent",
                color: sidebarTab === tab ? C.t1 : C.t4,
                borderBottom: `2px solid ${sidebarTab === tab ? C.ac : "transparent"}`,
              }}>{tab}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
            {sidebarTab === "files" && <FileTree files={mockFiles} onFileClick={handleFileClick} selectedFile={selectedFile} />}
            {sidebarTab === "git" && (
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: C.t3, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6 }}>STAGED</div>
                {["session.ts", "jwt.ts", "rbac.ts"].map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", fontSize: 12, color: C.t2 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: C.g, backgroundColor: C.gD, borderRadius: 3, padding: "1px 4px" }}>A</span>
                    src/auth/{f}
                  </div>
                ))}
                <div style={{ fontSize: 10, color: C.t3, fontWeight: 700, letterSpacing: "0.05em", marginTop: 12, marginBottom: 6 }}>MODIFIED</div>
                {["middleware.ts", "index.ts"].map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", fontSize: 12, color: C.t2 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: C.y, backgroundColor: C.yD, borderRadius: 3, padding: "1px 4px" }}>M</span>
                    src/auth/{f}
                  </div>
                ))}
              </div>
            )}
            {sidebarTab === "mcp" && (
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: C.t3, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8 }}>CONNECTED</div>
                {[{ n: "supabase", t: 12 }, { n: "github", t: 8 }, { n: "filesystem", t: 5 }].map(s => (
                  <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, marginBottom: 2, backgroundColor: C.bgE }}>
                    <Dot color={C.g} />
                    <span style={{ fontSize: 12, color: C.t2, flex: 1 }}>{s.n}</span>
                    <span style={{ fontSize: 10, color: C.t4 }}>{s.t} tools</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, padding: "10px 12px", borderTop: `1px solid ${C.brd}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: C.t4, fontWeight: 600 }}>CONTEXT</span>
              <span style={{ fontSize: 10, color: C.t3 }}>47K / 200K</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, backgroundColor: C.bgE, overflow: "hidden" }}>
              <div style={{ width: "23.5%", height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${C.ac}, ${C.acL})` }} />
            </div>
          </div>
        </div>

        {/* ─── CENTER: CHAT ─── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {mockMessages.map(msg => (
                <div key={msg.id} style={{ marginBottom: 24 }}>
                  {msg.role === "user" ? (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div style={{
                        borderRadius: "18px 18px 4px 18px", padding: "10px 16px", maxWidth: "80%",
                        fontSize: 13.5, lineHeight: 1.55, backgroundColor: C.acD, border: "1px solid rgba(124,58,237,0.2)",
                      }}>{msg.content}</div>
                    </div>
                  ) : (
                    <div>
                      {/* Activity indicator — clickable link to right panel */}
                      {msg.activityRef && msg.activityRef.length > 0 && (
                        <button onClick={() => setRightTab("activity")} style={{
                          display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8,
                          padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.brdL}`,
                          backgroundColor: "rgba(0,0,0,0.2)", cursor: "pointer",
                          fontSize: 11, color: C.t3, transition: "all 0.15s",
                        }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(124,58,237,0.3)"; e.currentTarget.style.color = C.acL; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = C.brdL; e.currentTarget.style.color = C.t3; }}
                        >
                          {(() => {
                            const acts = msg.activityRef.map(i => mockActivity[i]).filter(Boolean);
                            const writes = acts.filter(a => a.type === "write").length;
                            const edits = acts.filter(a => a.type === "edit").length;
                            const reads = acts.filter(a => a.type === "tool").length;
                            const pending = acts.some(a => a.status === "pending");
                            const parts = [];
                            if (reads) parts.push(`${reads} read${reads > 1 ? "s" : ""}`);
                            if (writes) parts.push(`${writes} created`);
                            if (edits) parts.push(`${edits} edited`);
                            return (
                              <>
                                {pending ? <Dot color={C.y} pulse /> : <Dot color={C.g} />}
                                <span>{parts.join(" \u00b7 ")}</span>
                                <span style={{ color: C.t4 }}>\u2192 Activity</span>
                              </>
                            );
                          })()}
                        </button>
                      )}
                      {/* Clean text response */}
                      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: C.t2 }}>
                        {msg.content.split("\n").map((line, li) => (
                          <div key={li} style={{ minHeight: line === "" ? 10 : undefined }}>
                            {line.split("**").map((seg, si) =>
                              si % 2 === 1
                                ? <strong key={si} style={{ color: C.t1, fontWeight: 600 }}>{seg}</strong>
                                : <span key={si}>{seg}</span>
                            )}
                          </div>
                        ))}
                        {msg.streaming && (
                          <span style={{ display: "inline-block", width: 2, height: 16, marginLeft: 2, backgroundColor: blink ? C.ac : "transparent", verticalAlign: "text-bottom", transition: "background-color 0.08s" }} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Input */}
          <div style={{ flexShrink: 0, padding: "0 24px 16px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", position: "relative" }}>

              {/* Command Palette Dropdown */}
              {showCmdPalette && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 6,
                  borderRadius: 14, backgroundColor: "#18181b", border: `1px solid ${C.brd}`,
                  boxShadow: "0 -12px 50px rgba(0,0,0,0.5)", overflow: "hidden", zIndex: 40,
                  maxHeight: 320, display: "flex", flexDirection: "column",
                }}>
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.brd}` }}>
                    <input value={cmdSearch} onChange={e => setCmdSearch(e.target.value)} placeholder="Search commands..."
                      autoFocus
                      style={{
                        width: "100%", background: "rgba(0,0,0,0.3)", border: `1px solid ${C.brdL}`,
                        borderRadius: 8, padding: "7px 10px", fontSize: 12, color: C.t1,
                        fontFamily: SN, outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {[
                      { cmd: "/compact", desc: "Compress conversation to save context", cat: "built-in" },
                      { cmd: "/clear", desc: "Clear conversation history", cat: "built-in" },
                      { cmd: "/model", desc: "Switch between Sonnet, Opus, Haiku", cat: "built-in" },
                      { cmd: "/init", desc: "Create CLAUDE.md for this project", cat: "built-in" },
                      { cmd: "/context", desc: "Show current context window usage", cat: "built-in" },
                      { cmd: "/help", desc: "Show all available commands", cat: "built-in" },
                      { cmd: "/review", desc: "Run code review on staged changes", cat: "custom" },
                      { cmd: "/deploy", desc: "Deploy to production via Netlify", cat: "custom" },
                      { cmd: "/test", desc: "Run test suite and fix failures", cat: "custom" },
                      { cmd: "/security-scan", desc: "Scan for vulnerabilities", cat: "custom" },
                    ].filter(c => !cmdSearch || c.cmd.includes(cmdSearch.toLowerCase()) || c.desc.toLowerCase().includes(cmdSearch.toLowerCase()))
                    .map(c => (
                      <div key={c.cmd} onClick={() => { setInput(c.cmd + " "); setShowCmdPalette(false); setCmdSearch(""); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                          cursor: "pointer", transition: "background-color 0.1s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
                      >
                        <span style={{
                          fontFamily: MN, fontSize: 12, fontWeight: 600, color: C.ac,
                          minWidth: 120,
                        }}>{c.cmd}</span>
                        <span style={{ fontSize: 12, color: C.t3, flex: 1 }}>{c.desc}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 600, color: c.cat === "built-in" ? C.t4 : C.acL,
                          backgroundColor: c.cat === "built-in" ? C.bgE : C.acD,
                          padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em",
                        }}>{c.cat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ borderRadius: 16, overflow: "hidden", backgroundColor: C.bgE, border: `1px solid ${C.brd}`, boxShadow: "0 -4px 40px rgba(0,0,0,0.15)" }}>

                {/* Attachment Preview Bar */}
                {attachments.length > 0 && (
                  <div style={{
                    display: "flex", gap: 8, padding: "10px 14px 0", flexWrap: "wrap",
                  }}>
                    {attachments.map(att => (
                      <div key={att.id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                        borderRadius: 10, backgroundColor: "rgba(0,0,0,0.25)", border: `1px solid ${C.brdL}`,
                        maxWidth: 220,
                      }}>
                        {/* Thumbnail or icon */}
                        {att.type === "image" ? (
                          <div style={{
                            width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                            background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, position: "relative", overflow: "hidden",
                          }}>
                            <div style={{
                              position: "absolute", inset: 0, opacity: 0.3,
                              backgroundImage: "repeating-conic-gradient(#fff 0% 25%, transparent 0% 50%)",
                              backgroundSize: "8px 8px",
                            }} />
                            <span style={{ position: "relative", zIndex: 1 }}>🖼</span>
                          </div>
                        ) : (
                          <div style={{
                            width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                            backgroundColor: "rgba(251,191,36,0.1)",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                          }}>📎</div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{
                            fontSize: 11.5, fontWeight: 500, color: C.t2,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{att.name}</div>
                          <div style={{ fontSize: 10, color: C.t4 }}>{att.size}</div>
                        </div>
                        <button onClick={() => setAttachments(p => p.filter(a => a.id !== att.id))} style={{
                          background: "none", border: "none", color: C.t4, cursor: "pointer",
                          fontSize: 14, lineHeight: 1, padding: 2, flexShrink: 0, opacity: 0.6,
                        }}>&times;</button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea value={input} onChange={e => {
                  setInput(e.target.value);
                  if (e.target.value === "/") setShowCmdPalette(true);
                  else if (!e.target.value.startsWith("/")) setShowCmdPalette(false);
                }} placeholder="Ask Claude anything... (⌘+Enter to send, / for commands)" rows={3}
                  style={{ width: "100%", background: "transparent", resize: "none", outline: "none", border: "none", padding: "14px 16px 8px", fontSize: 13.5, color: C.t1, fontFamily: SN, lineHeight: 1.5 }}
                  onPaste={e => {
                    const items = e.clipboardData?.items;
                    if (items) {
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.startsWith("image/")) {
                          e.preventDefault();
                          const newId = Math.max(0, ...attachments.map(a => a.id)) + 1;
                          setAttachments(p => [...p, {
                            id: newId, type: "image",
                            name: `clipboard_${new Date().toLocaleTimeString().replace(/:/g, "")}.png`,
                            size: "~clipboard", preview: true,
                          }]);
                        }
                      }
                    }
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px 10px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => {
                      const newId = Math.max(0, ...attachments.map(a => a.id)) + 1;
                      setAttachments(p => [...p, { id: newId, type: "file", name: "selected-file.ts", size: "4.2 KB", preview: false }]);
                    }} style={{ borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 500, color: C.t4, backgroundColor: "rgba(255,255,255,0.04)", border: `1px solid ${C.brdL}`, cursor: "pointer" }}>+ File</button>
                    <button onClick={() => setShowCmdPalette(p => !p)} style={{
                      borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 500,
                      color: showCmdPalette ? C.acL : C.t4,
                      backgroundColor: showCmdPalette ? C.acD : "rgba(255,255,255,0.04)",
                      border: `1px solid ${showCmdPalette ? "rgba(124,58,237,0.3)" : C.brdL}`, cursor: "pointer",
                    }}>/ Cmd</button>
                    <button style={{ borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 500, color: C.t4, backgroundColor: "rgba(255,255,255,0.04)", border: `1px solid ${C.brdL}`, cursor: "pointer" }}>@ Agent</button>
                    <span style={{ fontSize: 10, color: C.t5, display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
                      📋 ⌘V to paste screenshot
                    </span>
                  </div>
                  <button style={{
                    borderRadius: 10, padding: "6px 16px", fontSize: 12, fontWeight: 600, border: "none",
                    cursor: input.trim() || attachments.length ? "pointer" : "default",
                    background: (input.trim() || attachments.length) ? `linear-gradient(135deg, ${C.ac}, #6d28d9)` : C.bgE,
                    color: (input.trim() || attachments.length) ? "#fff" : C.t5,
                  }}>Send ⌘↵</button>
                </div>
              </div>
            </div>
          </div>

          {showApproval && <Approval tool={{ name: "Bash", args: "npx tsc --noEmit" }} onApprove={() => setShowApproval(false)} onDeny={() => setShowApproval(false)} />}
        </div>

        {/* ─── RIGHT PANEL ─── */}
        <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.brd}`, backgroundColor: "rgba(0,0,0,0.25)" }}>
          {/* Panel type tabs */}
          <div style={{ display: "flex", alignItems: "stretch", height: 36, flexShrink: 0, borderBottom: `1px solid ${C.brd}` }}>
            {[
              { id: "activity", label: "Activity", icon: "\u25cf" },
              { id: "terminal", label: "Terminal", icon: "▸_" },
              { id: "file", label: "File", icon: "{ }" },
              { id: "diff", label: "Diff", icon: "\u00b1" },
            ].map(tab => (
              <button key={tab.id} onClick={() => setRightTab(tab.id)} style={{
                flex: 1, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                backgroundColor: rightTab === tab.id ? "rgba(255,255,255,0.04)" : "transparent",
                borderBottom: `2px solid ${rightTab === tab.id ? C.ac : "transparent"}`,
                color: rightTab === tab.id ? C.t1 : C.t4, fontSize: 11, fontWeight: 600,
              }}>
                <span style={{ fontFamily: MN, fontSize: 10 }}>{tab.icon}</span>{tab.label}
              </button>
            ))}
          </div>

          {/* Terminal sub-tabs (only when terminal is active) */}
          {rightTab === "terminal" && (
            <div style={{
              display: "flex", alignItems: "center", height: 30, flexShrink: 0,
              borderBottom: `1px solid ${C.brd}`, backgroundColor: "rgba(0,0,0,0.15)",
              overflow: "hidden",
            }}>
              <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {terminalIds.map(id => {
                  const t = mockTerminals[id];
                  const on = id === activeTerminal;
                  const name = t ? t.name : `shell ${id}`;
                  const running = t?.running;
                  return (
                    <button key={id} onClick={() => setActiveTerminal(id)} style={{
                      display: "flex", alignItems: "center", gap: 5, padding: "0 10px",
                      border: "none", cursor: "pointer", height: "100%", minWidth: 0, maxWidth: 120,
                      backgroundColor: on ? "rgba(255,255,255,0.06)" : "transparent",
                      borderBottom: on ? `2px solid ${C.acL}` : "2px solid transparent",
                      transition: "all 0.1s",
                    }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)"; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.backgroundColor = on ? "rgba(255,255,255,0.06)" : "transparent"; }}
                    >
                      {running && <Dot color={C.g} pulse />}
                      <span style={{
                        fontSize: 10.5, fontWeight: on ? 600 : 400,
                        color: on ? C.t1 : C.t4,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{name}</span>
                      <span onClick={e => {
                        e.stopPropagation();
                        const next = terminalIds.filter(x => x !== id);
                        if (next.length > 0) {
                          setTerminalIds(next);
                          if (activeTerminal === id) setActiveTerminal(next[0]);
                        }
                      }} style={{
                        fontSize: 11, color: C.t5, lineHeight: 1, marginLeft: 2,
                        cursor: "pointer", opacity: 0.6,
                      }}>&times;</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => {
                const newId = nextTermId;
                setNextTermId(p => p + 1);
                setTerminalIds(p => [...p, newId]);
                setActiveTerminal(newId);
              }} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: "100%", border: "none", background: "none",
                cursor: "pointer", color: C.t4, fontSize: 14, flexShrink: 0,
              }}>+</button>
            </div>
          )}

          {/* Panel content */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {rightTab === "activity" && (
              <ActivityFeed
                activities={mockActivity}
                onFileClick={(file) => { setSelectedFile(file.split("/").pop()); setRightTab("file"); }}
                onDiffClick={() => setRightTab("diff")}
              />
            )}
            {rightTab === "terminal" && (() => {
              const t = mockTerminals[activeTerminal];
              const lines = t ? t.lines : [{ type: "cmd", text: "$ " }];
              return <Terminal lines={lines} input={termInput} setInput={setTermInput} />;
            })()}
            {rightTab === "file" && <FileViewer filename={selectedFile || "jwt.ts"} content={mockFileContent} />}
            {rightTab === "diff" && <DiffViewer hunks={mockDiff} />}
          </div>

          {/* Quick commands (only for terminal) */}
          {rightTab === "terminal" && (
            <div style={{ flexShrink: 0, padding: "6px 10px", borderTop: `1px solid ${C.brd}`, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["npm run dev", "npm test", "git status", "npx tsc"].map(cmd => (
                <button key={cmd} style={{ borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 500, color: C.t4, backgroundColor: C.bgE, border: `1px solid ${C.brdL}`, cursor: "pointer", fontFamily: MN }}>{cmd}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.14)}
        textarea::placeholder,input::placeholder{color:${C.t5}}
        *{box-sizing:border-box}
        button:active{transform:scale(0.98)}
      `}</style>
    </div>
  );
}
