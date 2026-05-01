"""
Build the Agentic UI overview deck — `agentic-ui-overview.pptx`.

Audience: senior execs (sections 1, 8.a, 9), architects (2-7, 8.b),
and developers (4-6, 8.c, 10). Slides are colour-coded by track in
the speaker-notes header so a presenter can mix-and-match.

Produces a self-contained `.pptx` next to this script. No external
templates required — the master is built programmatically from the
brand tokens below so the deck stays consistent if the theme changes.
"""
from __future__ import annotations

from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

OUT = Path(__file__).parent / "agentic-ui-overview.pptx"

# ── Brand tokens ────────────────────────────────────────────────────────────
BRAND        = RGBColor(0x4F, 0x46, 0xE5)   # indigo
BRAND_DEEP   = RGBColor(0x31, 0x27, 0xA3)
BRAND_TINT   = RGBColor(0xEE, 0xF2, 0xFF)
SURFACE      = RGBColor(0xFF, 0xFF, 0xFF)
SURFACE_2    = RGBColor(0xF1, 0xF5, 0xF9)
TEXT         = RGBColor(0x0F, 0x17, 0x2A)
TEXT_2       = RGBColor(0x33, 0x41, 0x55)
MUTED        = RGBColor(0x64, 0x74, 0x8B)
FAINT        = RGBColor(0x94, 0xA3, 0xB8)
BORDER       = RGBColor(0xE2, 0xE8, 0xF0)
OK           = RGBColor(0x05, 0x96, 0x69)
WARN         = RGBColor(0xD9, 0x77, 0x06)
BAD          = RGBColor(0xDC, 0x26, 0x26)
INFO         = RGBColor(0x02, 0x84, 0xC7)

W, H = Inches(13.333), Inches(7.5)            # 16:9 widescreen


def add(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])  # blank


def rect(slide, x, y, w, h, fill, line=None):
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    s.fill.solid(); s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(0.5)
    s.shadow.inherit = False
    return s


def rounded(slide, x, y, w, h, fill, line=None, radius=0.05):
    s = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    s.adjustments[0] = radius
    s.fill.solid(); s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(0.75)
    s.shadow.inherit = False
    return s


def text_box(slide, x, y, w, h, text, *,
             size=14, bold=False, color=TEXT, align=PP_ALIGN.LEFT,
             font="Calibri", anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    r = p.add_run(); r.text = text
    r.font.name = font
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    return tb


def bullets(slide, x, y, w, h, items, *,
            size=14, color=TEXT, gap=4, marker="•", marker_color=BRAND):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        p.level = 0
        # marker
        r0 = p.add_run(); r0.text = marker + "  "
        r0.font.name = "Calibri"; r0.font.size = Pt(size); r0.font.bold = True
        r0.font.color.rgb = marker_color
        # body
        if isinstance(item, tuple):
            head, tail = item
            r1 = p.add_run(); r1.text = head + " "
            r1.font.name = "Calibri"; r1.font.size = Pt(size); r1.font.bold = True
            r1.font.color.rgb = color
            r2 = p.add_run(); r2.text = tail
            r2.font.name = "Calibri"; r2.font.size = Pt(size); r2.font.color.rgb = color
        else:
            r = p.add_run(); r.text = item
            r.font.name = "Calibri"; r.font.size = Pt(size); r.font.color.rgb = color


def code_block(slide, x, y, w, h, lines):
    rect(slide, x, y, w, h, RGBColor(0x0F, 0x17, 0x2A))
    tb = slide.shapes.add_textbox(x + Inches(0.15), y + Inches(0.1),
                                  w - Inches(0.3), h - Inches(0.2))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(0)
        r = p.add_run(); r.text = line
        r.font.name = "Menlo"; r.font.size = Pt(11)
        r.font.color.rgb = RGBColor(0xE2, 0xE8, 0xF0)


def chip(slide, x, y, label, *, fg=BRAND_DEEP, bg=BRAND_TINT, size=10, w=None):
    if w is None:
        w = Inches(max(0.55, 0.10 * len(label) + 0.4))
    h = Inches(0.32)
    rounded(slide, x, y, w, h, bg, radius=0.5)
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = label
    r.font.name = "Calibri"; r.font.size = Pt(size); r.font.bold = True
    r.font.color.rgb = fg
    return w


def slide_chrome(slide, eyebrow, title, audience_tag=None):
    """Standard top chrome — left brand stripe, eyebrow, title, audience pill."""
    rect(slide, Inches(0), Inches(0), Inches(0.18), H, BRAND)
    text_box(slide, Inches(0.6), Inches(0.45), W - Inches(1.2), Inches(0.3),
             eyebrow, size=11, bold=True, color=BRAND)
    text_box(slide, Inches(0.6), Inches(0.75), W - Inches(3.8), Inches(0.6),
             title, size=28, bold=True, color=TEXT)
    if audience_tag:
        chip(slide, W - Inches(2.6), Inches(0.55),
             audience_tag, fg=BRAND_DEEP, bg=BRAND_TINT, size=10, w=Inches(2.0))


def slide_footer(slide, idx, total, section):
    rect(slide, Inches(0), H - Inches(0.4), W, Inches(0.4), SURFACE_2)
    text_box(slide, Inches(0.6), H - Inches(0.32), Inches(6), Inches(0.28),
             section, size=10, color=MUTED)
    text_box(slide, W - Inches(2), H - Inches(0.32), Inches(1.4), Inches(0.28),
             f"{idx} / {total}", size=10, color=MUTED, align=PP_ALIGN.RIGHT)
    text_box(slide, Inches(0.6), H - Inches(0.32), W - Inches(1.2), Inches(0.28),
             "@maverick/agentic-ui · Confidential",
             size=10, color=FAINT, align=PP_ALIGN.CENTER)


def add_speaker_notes(slide, *blocks):
    notes = slide.notes_slide.notes_text_frame
    notes.text = blocks[0] if blocks else ""
    for b in blocks[1:]:
        p = notes.add_paragraph(); p.text = b


# ── Slide builders ──────────────────────────────────────────────────────────

def slide_cover(prs):
    s = add(prs)
    rect(s, Inches(0), Inches(0), W, H, RGBColor(0x0F, 0x17, 0x2A))
    # Diagonal gradient feel via overlay rectangle
    rect(s, Inches(8), Inches(0), Inches(5.5), H, RGBColor(0x1E, 0x1B, 0x4B))
    rounded(s, Inches(0.8), Inches(0.8), Inches(0.6), Inches(0.6), BRAND, radius=0.2)
    text_box(s, Inches(0.92), Inches(0.87), Inches(0.45), Inches(0.46),
             "M", size=24, bold=True, color=SURFACE, align=PP_ALIGN.CENTER)
    text_box(s, Inches(1.6), Inches(0.85), Inches(6), Inches(0.5),
             "MAVERICK", size=16, bold=True, color=SURFACE)
    text_box(s, Inches(1.6), Inches(1.13), Inches(6), Inches(0.4),
             "AGENTIC UI", size=11, bold=True, color=BRAND_TINT)

    text_box(s, Inches(0.8), Inches(2.6), Inches(11), Inches(1.5),
             "Agentic UI for Angular —",
             size=44, bold=True, color=SURFACE)
    text_box(s, Inches(0.8), Inches(3.4), Inches(11), Inches(1.0),
             "AG-UI · Hashbrown · A2UI",
             size=44, bold=True, color=BRAND_TINT)

    text_box(s, Inches(0.8), Inches(4.7), Inches(11), Inches(0.6),
             "One library. Three protocols. Microfrontend-native.",
             size=18, color=RGBColor(0xC7, 0xD2, 0xFE))

    chip(s, Inches(0.8), Inches(5.7), "Senior executives", fg=SURFACE,
         bg=RGBColor(0x4F, 0x46, 0xE5), size=10, w=Inches(2.0))
    chip(s, Inches(2.95), Inches(5.7), "Solution architects", fg=SURFACE,
         bg=RGBColor(0x4F, 0x46, 0xE5), size=10, w=Inches(2.1))
    chip(s, Inches(5.2), Inches(5.7), "Developers", fg=SURFACE,
         bg=RGBColor(0x4F, 0x46, 0xE5), size=10, w=Inches(1.6))

    text_box(s, Inches(0.8), Inches(6.6), Inches(11), Inches(0.4),
             "An overview deck — features · examples · benefits · capabilities · roadmap",
             size=12, color=FAINT)
    add_speaker_notes(s,
        "Cover. The deck is structured for three audiences — pick the slides marked for your viewers and skip the rest.",
        "30-minute version: cover, 1, 2, 3, 6, 11, 13, 16, 17, 19, 21, 22, 23 (case study), 25 (matrix), 26-28 (benefits), 29 (CTA).",
        "60-minute version: include AG-UI/Hashbrown/A2UI deep dives and the registry tour.")
    return s


def slide_agenda(prs):
    s = add(prs)
    slide_chrome(s, "AGENDA", "What you'll leave with")
    items = [
        ("The shift.", "Why agentic UIs are the next interface paradigm — and the protocol problem nobody owns."),
        ("Three protocols.", "AG-UI, Hashbrown, A2UI — origin, model, fit, gaps."),
        ("One library.", "@maverick/agentic-ui — 13 registries, MFE-native, MCP-ready, telemetry-instrumented."),
        ("Working examples.", "demo-monolith, demo-shell + remotes, demo-multi-agent, demo-ediscovery — all in this repo."),
        ("Decision frameworks.", "Protocol matrix, when-to-use guide, persona-by-persona benefit map."),
        ("Roadmap & CTA.", "Where it's going through v1.0 — and where you can plug in."),
    ]
    bullets(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4), items, size=16, gap=8)
    add_speaker_notes(s, "Agenda. Pace this for 30 or 60 minutes — sub-deck markers in speaker notes for each track.")
    return s


def slide_shift(prs):
    s = add(prs)
    slide_chrome(s, "1 · THE SHIFT", "From chatbots to agentic UIs", "Senior executives")

    # Three columns: yesterday, today, tomorrow
    col_w = (W - Inches(1.4) - Inches(0.4)) / 3
    titles = ["Yesterday — chatbots", "Today — agentic UIs", "Tomorrow — agent-native apps"]
    bodies = [
        ["Text-only conversation",
         "Apps wired to LLMs as a fancy autocomplete",
         "Hand-coded handlers per use case",
         "No structured affordances — every flow re-debated"],
        ["Tool-call protocols (AG-UI / Hashbrown / A2UI)",
         "Generative UI: LLM emits widgets, host renders",
         "Multi-agent orchestration with sticky routing",
         "MCP server for analyst workstations"],
        ["UI itself is plug-in registry data",
         "Federated remotes contribute capabilities mid-session",
         "Audit-grade observability across LLM ↔ tool ↔ UI",
         "Persona-scoped governance baked in"],
    ]
    colors = [MUTED, BRAND_DEEP, OK]
    for i in range(3):
        x = Inches(0.7) + i * (col_w + Inches(0.2))
        rounded(s, x, Inches(1.7), col_w, Inches(5.0), SURFACE,
                line=BORDER, radius=0.04)
        rect(s, x, Inches(1.7), col_w, Inches(0.06), colors[i])
        text_box(s, x + Inches(0.25), Inches(1.85), col_w - Inches(0.5),
                 Inches(0.4), titles[i], size=15, bold=True, color=colors[i])
        bullets(s, x + Inches(0.25), Inches(2.4), col_w - Inches(0.5),
                Inches(4.0), bodies[i], size=12, gap=6, marker="—",
                marker_color=colors[i])
    add_speaker_notes(s,
        "The exec framing. Yesterday was wrappers around an LLM. Today's protocols (AG-UI/Hashbrown/A2UI) make the agent + UI a real surface.",
        "Tomorrow: the UI itself becomes plugin data. We are building for the third column.")
    return s


def slide_why_now(prs):
    s = add(prs)
    slide_chrome(s, "1 · THE SHIFT", "Why now", "Senior executives")

    drivers = [
        ("LLM-native tool calling matured.", "OpenAI, Anthropic, Google, Mistral all ship structured tool calls. Quality and latency now meet enterprise bars."),
        ("Three competing protocols emerged.", "AG-UI from CopilotKit, Hashbrown from Liquid Frontiers, A2UI from a multi-vendor consortium. Each is the leader in a slice."),
        ("MCP standardised the server side.", "Anthropic's Model Context Protocol made tool definitions portable across analyst workstations (Claude Desktop, Cursor, Zed)."),
        ("Generative UI moved past PoC.", "LLMs reliably emit JSON specifying widget + props; Angular signals + dynamic component loader make rendering trivial."),
        ("Regulated industries are catching up.", "Legal, healthcare, finance — all need defensible audit trails. The agentic UI substrate has to ship them by default."),
    ]
    bullets(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.0),
            drivers, size=14, gap=10)
    add_speaker_notes(s,
        "Why this matters now: protocols + tool-calling + MCP + generative UI all matured in a 12-month window.",
        "Buying or building? The protocols change every quarter. A library that abstracts them is the right unit of investment.")
    return s


def slide_three_protocols(prs):
    s = add(prs)
    slide_chrome(s, "1 · THE SHIFT", "Three protocols, one library", "Architects")

    # Three protocol cards in a row
    card_w = Inches(3.9); card_h = Inches(4.2); gap = Inches(0.3)
    start_x = Inches(0.7)
    protocols = [
        ("AG-UI", "CopilotKit",
         RGBColor(0x4F, 0x46, 0xE5),
         RGBColor(0xEE, 0xF2, 0xFF),
         ["Streaming via SSE",
          "Lifecycle + tool-call events",
          "Generative UI via show-component",
          "Mature client implementation",
          "Best for: server-driven agent flows"]),
        ("Hashbrown", "Liquid Frontiers",
         RGBColor(0x05, 0x96, 0x69),
         RGBColor(0xD1, 0xFA, 0xE5),
         ["UI-generation streams",
          "Widget + props natively",
          "Multi-provider (OpenAI, Google)",
          "Lighter than AG-UI",
          "Best for: rapid generative-UI demos"]),
        ("A2UI", "Multi-vendor consortium",
         RGBColor(0xD9, 0x77, 0x06),
         RGBColor(0xFE, 0xF3, 0xC7),
         ["ui-action event class",
          "Agent drives the whole UI",
          "Action-driven (not just tool-driven)",
          "Spec still evolving",
          "Best for: agent-driven nav + state"]),
    ]
    for i, (name, who, fg, bg, body) in enumerate(protocols):
        x = start_x + i * (card_w + gap)
        rounded(s, x, Inches(1.8), card_w, card_h, SURFACE, line=BORDER, radius=0.04)
        rect(s, x, Inches(1.8), card_w, Inches(0.5), fg)
        text_box(s, x + Inches(0.25), Inches(1.92), card_w - Inches(0.5),
                 Inches(0.3), name, size=18, bold=True, color=SURFACE)
        text_box(s, x + Inches(0.25), Inches(2.4), card_w - Inches(0.5),
                 Inches(0.4), f"By {who}", size=11, bold=True, color=fg)
        bullets(s, x + Inches(0.25), Inches(2.85), card_w - Inches(0.5),
                Inches(2.8), body, size=12, gap=6, marker="·",
                marker_color=fg)

    text_box(s, Inches(0.7), Inches(6.2), W - Inches(1.4), Inches(0.8),
             "@maverick/agentic-ui — one AgenticBackend abstraction; chat shell, registries, and widgets stay protocol-agnostic.",
             size=14, bold=True, color=BRAND_DEEP, align=PP_ALIGN.CENTER)
    add_speaker_notes(s,
        "AG-UI: most mature, best for server-driven flows where the agent emits streamed text + tool calls + widgets.",
        "Hashbrown: lighter weight, faster to prototype, multi-provider out of the box.",
        "A2UI: distinguishing feature is the ui-action class — the agent can navigate, fill forms, mutate stores. Spec still moving.")
    return s


# ── AG-UI deep dive ─────────────────────────────────────────────────────────

def slide_agui_background(prs):
    s = add(prs)
    slide_chrome(s, "2 · AG-UI", "Background & origin", "Architects")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "Open protocol for agent ↔ UI communication, originated by CopilotKit.",
             size=16, color=TEXT_2)

    facts = [
        ("Transport-agnostic.", "SSE in practice; WebSocket and plain HTTP also valid carriers."),
        ("Message-based.", "Discrete event types — RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, RUN_FINISHED — not a free-form stream."),
        ("Tool-call first-class.", "Distinguishes server-side tools (run on the agent host) from client-side tools (run in the browser)."),
        ("Generative UI by convention.", "Reserved show-component tool whose result tells the host which registered widget to render."),
        ("Reference implementation.", "@ag-ui/client — the runUntilSettled loop + HttpAgent SSE adapter — is the canonical client."),
        ("Adoption.", "CopilotKit, AG-UI Studio, multiple Mastra-based agent backends, several Angular and React reference apps."),
    ]
    bullets(s, Inches(0.7), Inches(2.4), W - Inches(1.4), Inches(4.5),
            facts, size=13, gap=8)
    add_speaker_notes(s,
        "AG-UI is the one most enterprise teams pick today. The reason: it cleanly maps lifecycle, text, and tool calls to discrete events — easy to log, easy to audit.",
        "Origin: CopilotKit. Anglo/architects.io article is the canonical primer.")
    return s


def slide_agui_events(prs):
    s = add(prs)
    slide_chrome(s, "2 · AG-UI", "Event model — the wire format", "Developers")

    rounded(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            SURFACE, line=BORDER, radius=0.02)

    sections = [
        ("Lifecycle",   ["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR"], BRAND),
        ("Text",        ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"], INFO),
        ("Tool calls",  ["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT"], OK),
        ("Generative",  ["WIDGET_RENDER (synth from show-component)", "UI_ACTION (A2UI extension)"], WARN),
    ]
    y = Inches(1.95)
    for title, evts, color in sections:
        rect(s, Inches(0.9), y, Inches(0.16), Inches(1.0), color)
        text_box(s, Inches(1.2), y, Inches(2.5), Inches(0.4),
                 title, size=14, bold=True, color=color)
        text_box(s, Inches(1.2), y + Inches(0.4), Inches(11), Inches(0.6),
                 "  ·  ".join(evts), size=12, color=TEXT_2,
                 font="Menlo")
        y += Inches(1.15)

    text_box(s, Inches(0.7), Inches(6.7), W - Inches(1.4), Inches(0.4),
             "Mapped 1:1 in @maverick/agentic-ui's AgenticBackend.run() event union — adapters never re-shape the model.",
             size=11, color=MUTED, align=PP_ALIGN.CENTER)
    add_speaker_notes(s,
        "Show this slide to engineers. Each event has a stable schema; AG-UI never embeds free-form payloads at the boundary.",
        "Our adapter @maverick/agentic-ui/ag-ui maps these 1:1 — you can build a debugger by tapping the AgenticBackend stream.")
    return s


def slide_agui_capabilities(prs):
    s = add(prs)
    slide_chrome(s, "2 · AG-UI", "Capabilities & where it fits")

    # Two columns: Strengths and Gaps
    col_w = (W - Inches(1.4) - Inches(0.3)) / 2
    rounded(s, Inches(0.7), Inches(1.7), col_w, Inches(5.0), SURFACE, line=BORDER)
    rect(s, Inches(0.7), Inches(1.7), Inches(0.06), Inches(5.0), OK)
    text_box(s, Inches(0.95), Inches(1.85), col_w - Inches(0.4), Inches(0.4),
             "Strengths", size=15, bold=True, color=OK)
    bullets(s, Inches(0.95), Inches(2.4), col_w - Inches(0.4), Inches(4.4),
            ["Cleanest event model of the three",
             "Server-side tool execution baked in",
             "SSE — proxies and CDNs handle it natively",
             "Mature CopilotKit + Mastra ecosystem",
             "Trace-friendly: each event is a structured record",
             "Best fit for compliance / audit / regulated domains"],
            size=12, gap=6, marker_color=OK)

    rounded(s, Inches(0.7) + col_w + Inches(0.3), Inches(1.7), col_w,
            Inches(5.0), SURFACE, line=BORDER)
    rect(s, Inches(0.7) + col_w + Inches(0.3), Inches(1.7), Inches(0.06),
         Inches(5.0), WARN)
    text_box(s, Inches(0.95) + col_w + Inches(0.3), Inches(1.85),
             col_w - Inches(0.4), Inches(0.4),
             "Trade-offs / gaps", size=15, bold=True, color=WARN)
    bullets(s, Inches(0.95) + col_w + Inches(0.3), Inches(2.4),
            col_w - Inches(0.4), Inches(4.4),
            ["Heavier than Hashbrown — more events to handle",
             "ui-action / agent-driven nav not in core spec",
             "Generative UI is via convention, not a first-class event",
             "No standard form schema — apps roll their own",
             "Per-protocol adapter still required (we provide one)"],
            size=12, gap=6, marker_color=WARN)
    add_speaker_notes(s,
        "When to pick AG-UI: regulated industries, audit-grade trails, server-side tool catalogs.",
        "When NOT: lightweight prototypes, mostly-client-rendered UIs with little server orchestration — Hashbrown is faster to spin up.")
    return s


# ── Hashbrown deep dive ─────────────────────────────────────────────────────

def slide_hashbrown_background(prs):
    s = add(prs)
    slide_chrome(s, "3 · HASHBROWN", "Background & origin", "Architects")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "Open framework from Liquid Frontiers focused on generative UI and tool-calling.",
             size=16, color=TEXT_2)
    facts = [
        ("UI-generation native.", "Hashbrown's streams emit component + props directly — no show-component shim required."),
        ("Multi-provider out of the box.", "OpenAI, Google, and Anthropic — swap providers via a config flag."),
        ("Smaller surface than AG-UI.", "Fewer event types; lifecycle is implicit in stream open/close."),
        ("React-first heritage.", "Original target was React; Angular adapter is recent. Our wrapper makes it idiomatic for either."),
        ("Schema-driven UI generation.", "Zod-based component schemas anchor the LLM's structured output."),
        ("Best fit.", "Rapid prototypes, demo-heavy generative UI, multi-LLM A/B comparisons."),
    ]
    bullets(s, Inches(0.7), Inches(2.4), W - Inches(1.4), Inches(4.5),
            facts, size=13, gap=8)
    add_speaker_notes(s,
        "Hashbrown's pitch: thinner protocol, faster start, multi-provider built in.",
        "Trade-off: the lifecycle isn't as crisp, so audit-grade logging needs extra work.")
    return s


def slide_hashbrown_features(prs):
    s = add(prs)
    slide_chrome(s, "3 · HASHBROWN", "Features at a glance", "Developers")

    bullet_rows = [
        ("ui-stream",    "Emits widget + props natively — no shim", BRAND),
        ("text-stream",  "Token-level text deltas",                  INFO),
        ("tool-stream",  "Function-call args + results",             OK),
        ("provider-mux", "Switch OpenAI ↔ Google ↔ Anthropic at runtime", WARN),
        ("schema-anchor","Zod schemas anchor structured LLM output",  BAD),
        ("react-bridge", "First-class React; Angular via wrapper",    MUTED),
    ]
    y = Inches(1.85)
    row_h = Inches(0.74)
    for tag, desc, color in bullet_rows:
        rounded(s, Inches(0.7), y, W - Inches(1.4), row_h - Inches(0.1),
                SURFACE, line=BORDER, radius=0.04)
        chip(s, Inches(0.9), y + Inches(0.13), tag, fg=SURFACE, bg=color,
             size=11, w=Inches(1.6))
        text_box(s, Inches(2.7), y + Inches(0.18), W - Inches(3.6),
                 Inches(0.4), desc, size=13, color=TEXT_2)
        y += row_h
    add_speaker_notes(s,
        "Highlight provider-mux — for an org doing LLM evaluation, Hashbrown lets you swap providers without rewiring the chat shell.",
        "Highlight schema-anchor — Zod schemas are the contract; same library + skill in our schematics.")
    return s


def slide_hashbrown_vs_agui(prs):
    s = add(prs)
    slide_chrome(s, "3 · HASHBROWN", "Hashbrown vs AG-UI — when to pick what")

    rows = [
        ("Lifecycle clarity",   "Implicit (stream open/close)", "Explicit (RUN_STARTED/FINISHED)", "AG-UI"),
        ("Generative UI",       "Native (UI-stream)",            "Convention (show-component)",     "Hashbrown"),
        ("Audit-grade logging", "Needs work — synth lifecycle",  "Drop-in — events are records",    "AG-UI"),
        ("Time-to-first-prompt","Hours",                          "Day or two",                      "Hashbrown"),
        ("Multi-provider",      "Built in",                       "Adapter per provider",             "Hashbrown"),
        ("Server-side tools",   "Adapter needed",                 "First-class",                     "AG-UI"),
        ("Spec stability",      "Smaller surface · stable",       "Larger surface · stable",         "Tie"),
    ]
    rounded(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            SURFACE, line=BORDER, radius=0.01)

    # Header
    rect(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5), SURFACE_2)
    text_box(s, Inches(0.9),  Inches(1.78), Inches(3.0), Inches(0.4),
             "Dimension", size=11, bold=True, color=MUTED)
    text_box(s, Inches(4.0),  Inches(1.78), Inches(3.0), Inches(0.4),
             "Hashbrown", size=11, bold=True, color=OK)
    text_box(s, Inches(7.2),  Inches(1.78), Inches(3.0), Inches(0.4),
             "AG-UI", size=11, bold=True, color=BRAND)
    text_box(s, Inches(10.6), Inches(1.78), Inches(2.0), Inches(0.4),
             "Pick", size=11, bold=True, color=TEXT)

    y = Inches(2.2)
    for dim, hb, agui, pick in rows:
        text_box(s, Inches(0.9), y, Inches(3.0), Inches(0.5),
                 dim, size=12, bold=True, color=TEXT)
        text_box(s, Inches(4.0), y, Inches(3.1), Inches(0.5),
                 hb, size=12, color=TEXT_2)
        text_box(s, Inches(7.2), y, Inches(3.3), Inches(0.5),
                 agui, size=12, color=TEXT_2)
        chip(s, Inches(10.6), y + Inches(0.05), pick,
             fg=BRAND_DEEP if pick != "Tie" else MUTED,
             bg=BRAND_TINT if pick != "Tie" else SURFACE_2,
             size=10, w=Inches(1.5))
        y += Inches(0.66)
    add_speaker_notes(s,
        "Decision matrix to share with architects. Not a verdict — a guide.",
        "Most enterprises pick AG-UI for production; Hashbrown for prototyping.")
    return s


# ── A2UI ────────────────────────────────────────────────────────────────────

def slide_a2ui(prs):
    s = add(prs)
    slide_chrome(s, "4 · A2UI", "Agent-driven UI — ui-action as a class", "Architects")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "A2UI lifts the agent from 'calls tools' to 'drives the whole UI'.",
             size=16, color=TEXT_2)

    text_box(s, Inches(0.7), Inches(2.4), W - Inches(1.4), Inches(0.4),
             "Distinguishing event class", size=14, bold=True, color=WARN)
    code_block(s, Inches(0.7), Inches(2.85), W - Inches(1.4), Inches(1.6), [
        "{ type: 'ui-action',",
        "  actionId: 'a-7f2e',",
        "  op: 'navigate',          // or 'applyTag', 'fillForm', 'openDrawer', …",
        "  payload: { path: '/documents', queryParams: { id: 'DOC-1234' } } }",
    ])

    text_box(s, Inches(0.7), Inches(4.7), W - Inches(1.4), Inches(0.4),
             "Where it shines", size=14, bold=True, color=BRAND)
    bullets(s, Inches(0.7), Inches(5.15), W - Inches(1.4), Inches(2.0), [
        "Agent navigates to a route after a tool call settles",
        "Form-fill flows where the agent populates fields the user verifies",
        "State mutations dispatched into NgRx / Redux without a separate tool",
        "Cross-MFE coordination — one remote raises an action a different remote handles",
    ], size=13, gap=6, marker_color=BRAND)

    add_speaker_notes(s,
        "A2UI is younger; specification still evolving. We reserve ui-action in our event union from M1 so the chat shell never breaks when the spec moves.",
        "Same pattern — clickable widgets in our eDiscovery demo dispatch openCustodian/openDocument/openHold actions through ActionRegistry.")
    return s


# ── @maverick/agentic-ui — the library ──────────────────────────────────────

def slide_lib_problem(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "Why a library", "Senior executives")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "Three protocols, four bundlers, two MFE runtimes, and an MCP transport — that's not a library, that's a forklift.",
             size=15, color=TEXT_2)
    rounded(s, Inches(0.7), Inches(2.5), Inches(6.0), Inches(4.4),
            RGBColor(0xFE, 0xF2, 0xF2), line=BAD, radius=0.04)
    text_box(s, Inches(0.95), Inches(2.65), Inches(5.5), Inches(0.4),
             "What you'd build without it", size=14, bold=True, color=BAD)
    bullets(s, Inches(0.95), Inches(3.15), Inches(5.5), Inches(3.5), [
        "Per-protocol chat shell, three times",
        "Hand-rolled tool registry, ad hoc per app",
        "Bespoke MFE federation glue for each remote",
        "MCP server scaffolding from scratch",
        "Telemetry stitched in late, never quite consistent",
        "Schematics: none — every team retypes the bootstrap",
    ], size=12, gap=6, marker="✗", marker_color=BAD)

    rounded(s, Inches(7.0), Inches(2.5), Inches(5.7), Inches(4.4),
            RGBColor(0xEC, 0xFD, 0xF5), line=OK, radius=0.04)
    text_box(s, Inches(7.25), Inches(2.65), Inches(5.2), Inches(0.4),
             "What @maverick/agentic-ui ships", size=14, bold=True, color=OK)
    bullets(s, Inches(7.25), Inches(3.15), Inches(5.2), Inches(3.5), [
        "One AgenticBackend interface — three adapters",
        "13 typed registries, one base class, signal-backed",
        "Native + Module Federation, both first-class",
        "@maverick/agentic-ui-mcp wraps tools as MCP",
        "OTel-instrumented from M1; default no-op",
        "ng add scaffolds an entire app in one command",
    ], size=12, gap=6, marker="✓", marker_color=OK)
    add_speaker_notes(s,
        "Frame for execs: building from scratch is a 6+ month investment. The library is a 2-week pilot.",
        "Production-grade, MIT-licensed, MIT-friendly. No vendor lock-in to a paid SaaS.")
    return s


def slide_lib_architecture(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "Architecture at a glance", "Architects")

    # Layered stack visualisation
    layers = [
        ("UI layer",     "ChatShell · WidgetContainer · FormRenderer",  BRAND),
        ("Agentic core", "injectAgenticChat() · runUntilSettled · resource()", BRAND_DEEP),
        ("Registry layer", "13 registries — Tool, Component, Action, Form, …", INFO),
        ("Backend adapters", "AgUiBackend · HashbrownBackend · A2uiBackend",   OK),
        ("Federation runtime", "Native Federation + Module Federation",       WARN),
        ("Remotes / MCP", "CapabilityModule · MfeRegistryClient · MCP server", BAD),
    ]

    layer_w = W - Inches(1.4)
    layer_h = Inches(0.75)
    y = Inches(1.85)
    for title, body, color in layers:
        rounded(s, Inches(0.7), y, layer_w, layer_h, SURFACE, line=BORDER, radius=0.04)
        rect(s, Inches(0.7), y, Inches(0.16), layer_h, color)
        text_box(s, Inches(1.0), y + Inches(0.12), Inches(2.4),
                 Inches(0.3), title, size=12, bold=True, color=color)
        text_box(s, Inches(3.5), y + Inches(0.18), layer_w - Inches(3.0),
                 Inches(0.4), body, size=11, color=TEXT_2)
        y += layer_h + Inches(0.08)

    text_box(s, Inches(0.7), Inches(6.7), W - Inches(1.4), Inches(0.4),
             "Cross-cutting: AgenticTelemetrySink · AgenticLogger — every layer pushes events; OTel exporter via /otel.",
             size=11, color=MUTED, align=PP_ALIGN.CENTER)
    add_speaker_notes(s,
        "Six layers, one library. Ergonomic seam between every pair.",
        "The chat shell never knows which protocol is in use; the protocol adapter never knows about MFEs; the federation runtime is orthogonal.")
    return s


def slide_lib_registries(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "13 registries — the data model", "Architects")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.4),
             "All 13 implement one Registry<TDef> interface — same MFE-aware teardown, same signal contract, same conformance test surface.",
             size=12, color=TEXT_2)

    # Tier columns
    col_w = (W - Inches(1.4) - Inches(0.4)) / 3
    titles = ["Core (M1–M3)\nchat shell depends on these",
              "Extended (M4–M5)\nfull agent-driven UI",
              "Seams (M4–M5)\ninterface + thin default"]
    bodies = [
        ["ToolRegistry",
         "ComponentRegistry  (alias WidgetRegistry)",
         "CapabilityRegistry",
         "BackendRegistry",
         "MfeRegistry  (external)"],
        ["ActionRegistry",
         "IntentRegistry",
         "FormRegistry",
         "DataSourceRegistry"],
        ["ValidationRegistry",
         "PersistenceRegistry",
         "LayoutRegistry",
         "SchemaTransformerRegistry"],
    ]
    colors = [BRAND, OK, WARN]
    for i in range(3):
        x = Inches(0.7) + i * (col_w + Inches(0.2))
        rounded(s, x, Inches(2.3), col_w, Inches(4.5), SURFACE, line=BORDER, radius=0.03)
        rect(s, x, Inches(2.3), col_w, Inches(0.06), colors[i])
        text_box(s, x + Inches(0.2), Inches(2.45), col_w - Inches(0.4),
                 Inches(0.7), titles[i], size=12, bold=True, color=colors[i])
        bullets(s, x + Inches(0.2), Inches(3.25), col_w - Inches(0.4),
                Inches(3.4), bodies[i], size=12, gap=6, marker="—",
                marker_color=colors[i])
    add_speaker_notes(s,
        "13 registries sound like a lot — pay attention to the tiers. Most apps will only ever populate Tool + Component.",
        "Adding a new registry is ~30 LOC because they all share a base; cost per registry is sublinear.")
    return s


def slide_lib_backend(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "AgenticBackend — the abstraction", "Developers")

    code_block(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(3.7), [
        "export interface AgenticBackend {",
        "  readonly id: string;",
        "  readonly capabilities: {",
        "    streaming: boolean;",
        "    clientTools: boolean;",
        "    generativeUi: boolean;",
        "    uiActions: boolean;     // A2UI",
        "  };",
        "  run(input: AgenticRunInput): AsyncIterable<AgenticEvent>;",
        "  reset?(threadId: string): Promise<void>;",
        "}",
        "",
        "// 12 events: run-started, text-delta, tool-call-*, widget-render, ui-action, …",
        "export type AgenticEvent =",
        "  | { type: 'run-started'; threadId: string; runId: string }",
        "  | { type: 'text-delta'; messageId: string; delta: string }",
        "  | { type: 'tool-call-result'; toolCallId: string; result: unknown }",
        "  | { type: 'widget-render'; widgetCallId: string; name: string; props: unknown }",
        "  | { type: 'ui-action'; actionId: string; op: string; payload: unknown }",
        "  | … ;",
    ])

    text_box(s, Inches(0.7), Inches(5.7), W - Inches(1.4), Inches(1.2),
             "The chat shell sees ONLY this surface. AgUiBackend, HashbrownBackend, "
             "A2uiBackend implement it — capability flags drive feature-detection in the UI.",
             size=12, color=TEXT_2, align=PP_ALIGN.CENTER)
    add_speaker_notes(s,
        "Show this slide to engineers. The chat shell is protocol-agnostic; only the backend adapter knows the wire format.",
        "Adding a new protocol is implementing this one interface.")
    return s


def slide_lib_mfe(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "Microfrontend federation — capability handoff", "Architects")

    bullets(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(2.5), [
        ("Discover.", "MfeRegistryClient.discover(env) — Spring Boot or static-JSON adapter."),
        ("Lazy-load.", "loadRemoteModule({ remoteName, exposedModule: './Capability' })."),
        ("Register.", "Remote's defineCapabilityModule pushes into ToolRegistry / ComponentRegistry / ActionRegistry."),
        ("Teardown.", "removeBySource('remote:bookings') runs across every registry in one pass; signals notify subscribers."),
    ], size=13, gap=6)

    rounded(s, Inches(0.7), Inches(4.3), Inches(5.85), Inches(2.6),
            BRAND_TINT, line=BORDER, radius=0.04)
    text_box(s, Inches(0.95), Inches(4.45), Inches(5.4), Inches(0.4),
             "Native Federation (default)", size=13, bold=True, color=BRAND_DEEP)
    bullets(s, Inches(0.95), Inches(4.85), Inches(5.4), Inches(2.0), [
        "Backed by @angular-architects/native-federation",
        "esbuild-compatible — Angular CLI default",
        "Smaller bundle, faster cold start"
    ], size=12, gap=4, marker="—", marker_color=BRAND_DEEP)

    rounded(s, Inches(6.85), Inches(4.3), Inches(5.85), Inches(2.6),
            RGBColor(0xFE, 0xF3, 0xC7), line=BORDER, radius=0.04)
    text_box(s, Inches(7.1), Inches(4.45), Inches(5.4), Inches(0.4),
             "Module Federation (peer)", size=13, bold=True, color=WARN)
    bullets(s, Inches(7.1), Inches(4.85), Inches(5.4), Inches(2.0), [
        "Backed by @module-federation/runtime",
        "webpack — for teams already on it",
        "Same CapabilityModule format · same capabilities.json"
    ], size=12, gap=4, marker="—", marker_color=WARN)
    add_speaker_notes(s,
        "Both federation paths are first-class — neither is a side branch.",
        "Switch via `ng add @maverick/agentic-ui --federation=native` vs `--federation=module-federation`.")
    return s


def slide_lib_mcp(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "MCP integration — analyst workstation reach")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "@maverick/agentic-ui-mcp — the same ToolDefs power Claude Desktop, Cursor, Zed.",
             size=15, color=TEXT_2)

    rounded(s, Inches(0.7), Inches(2.5), W - Inches(1.4), Inches(3.4),
            SURFACE_2, line=BORDER, radius=0.02)
    text_box(s, Inches(0.95), Inches(2.65), W - Inches(1.8), Inches(0.4),
             "One handler, multiple surfaces", size=14, bold=True, color=BRAND_DEEP)
    bullets(s, Inches(0.95), Inches(3.1), W - Inches(1.8), Inches(2.6), [
        "agenticTool({ ... }) — same factory the chat shell uses",
        "mcpToolBridge(tools) — exposes them as an MCP server with a Node binary",
        "MCP UI: tool results carry html field → text/html;profile=mcp-app blocks",
        "Per-user MCP server pattern — beforeCall stub auth → real OIDC swap-in",
        "Cookbook: paralegal privilege review in Claude Desktop using the eDiscovery toolset",
    ], size=12, gap=6)

    text_box(s, Inches(0.7), Inches(6.2), W - Inches(1.4), Inches(0.6),
             "Result: agents that work in your web app AND in your analysts' IDE — same audit trail, same governance.",
             size=12, color=BRAND_DEEP, bold=True, align=PP_ALIGN.CENTER)
    add_speaker_notes(s,
        "Big win for regulated industries — MCP brings agentic UI into Claude Desktop where many analysts already live.",
        "Demonstrate by walking through demo-mcp-server then opening Claude Desktop.")
    return s


def slide_lib_telemetry(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "Observability — OTel from M1", "Architects")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "Distributed tracing for chat shell → backend → SSE route → agent → LLM → tool execution.",
             size=14, color=TEXT_2)

    rows = [
        ("agentic.run",            "INTERNAL", "thread_id, run_id, backend.id"),
        ("agentic.backend.stream", "CLIENT",   "http.url, http.status_code, traceparent"),
        ("agentic.tool_call",      "INTERNAL", "tool.name, tool.source, success"),
        ("agentic.federation.load","INTERNAL", "remote_name, version, federation, load_ms"),
        ("agentic.registry.register","INTERNAL","registry.name, source"),
    ]
    rounded(s, Inches(0.7), Inches(2.5), W - Inches(1.4), Inches(3.7),
            SURFACE, line=BORDER, radius=0.02)
    rect(s, Inches(0.7), Inches(2.5), W - Inches(1.4), Inches(0.45), SURFACE_2)
    text_box(s, Inches(0.95), Inches(2.55), Inches(4.0), Inches(0.4),
             "Span", size=11, bold=True, color=MUTED)
    text_box(s, Inches(5.0), Inches(2.55), Inches(2.0), Inches(0.4),
             "Kind", size=11, bold=True, color=MUTED)
    text_box(s, Inches(7.5), Inches(2.55), Inches(5.0), Inches(0.4),
             "Key attributes", size=11, bold=True, color=MUTED)
    y = Inches(2.95)
    for span, kind, attrs in rows:
        text_box(s, Inches(0.95), y, Inches(4.0), Inches(0.5),
                 span, size=12, bold=True, color=BRAND_DEEP, font="Menlo")
        text_box(s, Inches(5.0), y, Inches(2.0), Inches(0.5),
                 kind, size=11, color=MUTED)
        text_box(s, Inches(7.5), y, Inches(5.0), Inches(0.5),
                 attrs, size=11, color=TEXT_2, font="Menlo")
        y += Inches(0.55)

    text_box(s, Inches(0.7), Inches(6.4), W - Inches(1.4), Inches(0.5),
             "W3C traceparent propagated across the SSE boundary — one trace covers UI to LLM.",
             size=11, color=MUTED, align=PP_ALIGN.CENTER, bold=True)
    add_speaker_notes(s,
        "Default sink is no-op; consumer opts in to OTel via @maverick/agentic-ui/otel.",
        "Bundle impact: zero unless they import the otel entry — measured in CI.")
    return s


def slide_lib_schematics(prs):
    s = add(prs)
    slide_chrome(s, "5 · THE LIBRARY", "Schematics — ng add → fully wired app", "Developers")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.4),
             "@maverick/agentic-ui-schematics — six generators ship with the package.",
             size=14, color=TEXT_2)

    code_block(s, Inches(0.7), Inches(2.2), W - Inches(1.4), Inches(2.5), [
        "$ ng add @maverick/agentic-ui \\",
        "    --backend=ag-ui \\",
        "    --mfe=host --federation=native \\",
        "    --registry=spring-boot \\",
        "    --server=mastra \\",
        "    --telemetry=otel",
        "",
        "Patches app.config.ts · seeds tools/widgets · scaffolds federation · ",
        "wires Mastra agent server · adds OTel collector config",
    ])

    text_box(s, Inches(0.7), Inches(5.0), W - Inches(1.4), Inches(0.4),
             "Per-artefact generators", size=14, bold=True, color=BRAND)
    bullets(s, Inches(0.7), Inches(5.5), W - Inches(1.4), Inches(1.7), [
        ("ng g …:tool",            "*.tool.ts with Zod schema scaffold; auto-registers"),
        ("ng g …:widget",          "Standalone component + Zod props schema"),
        ("ng g …:backend",         "Custom AgenticBackend with FakeAgenticBackend test"),
        ("ng g …:mfe-capability",  "Federation expose + capabilities.json manifest"),
        ("ng g …:agent-server",    "Mastra agent + AG-UI SSE route + memory store"),
        ("ng g …:chat-shell",      "Routed component using <mvk-chat-shell>"),
    ], size=12, gap=4)
    add_speaker_notes(s,
        "Show this slide to developers — the schematics are the value-multiplier.",
        "ng add takes a fresh Angular app to running chat in <2 minutes.")
    return s


# ── Examples (the demos in this repo) ───────────────────────────────────────

def slide_examples_overview(prs):
    s = add(prs)
    slide_chrome(s, "6 · EXAMPLES", "Five demos in this repo", "Developers")

    rows = [
        ("demo-monolith",        "Single-app AG-UI parity",                "M1 baseline · same shape as flights42"),
        ("demo-feature-tour",    "All 13 registries in one app",          "ActionRegistry, FormRegistry, IntentRegistry, DataSource"),
        ("demo-shell + remotes", "Native Federation host + bookings/loyalty/support",
                                 "Capability handoff · prefetchCapabilities"),
        ("demo-multi-agent",     "OrchestratorAgent + specialists",       "Sticky routing · ThreadStateStore"),
        ("demo-mcp-server",      "Tools as MCP server",                   "Claude Desktop · MCP UI · per-user instances"),
        ("demo-ediscovery",      "Enterprise reference app",              "Federated review remote · audit trail · 5 personas"),
    ]
    rounded(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            SURFACE, line=BORDER, radius=0.02)
    rect(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5), SURFACE_2)
    text_box(s, Inches(0.95), Inches(1.78), Inches(4.0), Inches(0.4),
             "Demo", size=11, bold=True, color=MUTED)
    text_box(s, Inches(5.0), Inches(1.78), Inches(3.5), Inches(0.4),
             "What it shows", size=11, bold=True, color=MUTED)
    text_box(s, Inches(8.7), Inches(1.78), Inches(4.0), Inches(0.4),
             "Library features exercised", size=11, bold=True, color=MUTED)
    y = Inches(2.25)
    for name, what, feats in rows:
        text_box(s, Inches(0.95), y, Inches(4.0), Inches(0.6),
                 name, size=12, bold=True, color=BRAND_DEEP, font="Menlo")
        text_box(s, Inches(5.0), y, Inches(3.6), Inches(0.6),
                 what, size=11, color=TEXT_2)
        text_box(s, Inches(8.7), y, Inches(4.1), Inches(0.6),
                 feats, size=10, color=MUTED)
        y += Inches(0.78)
    add_speaker_notes(s,
        "Six demos. Pick one for each audience.",
        "demo-ediscovery is the headline — full enterprise pattern with federation + audit + multi-persona.")
    return s


def slide_example_ediscovery(prs):
    s = add(prs)
    slide_chrome(s, "6 · EXAMPLES", "Case study — eDiscovery reference app", "Senior executives")

    text_box(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.5),
             "Multi-pane enterprise app: matter dashboard · documents · custodians · holds · audit trail · MCP-powered analyst tools.",
             size=14, color=TEXT_2)

    rounded(s, Inches(0.7), Inches(2.4), Inches(8.0), Inches(4.6),
            SURFACE, line=BORDER, radius=0.02)
    text_box(s, Inches(0.95), Inches(2.55), Inches(7.5), Inches(0.4),
             "What ships in the demo", size=14, bold=True, color=BRAND_DEEP)
    bullets(s, Inches(0.95), Inches(3.0), Inches(7.5), Inches(4.0), [
        "5 collection tools (custodian intake, legal-hold lifecycle)",
        "4 review tools (search, tag, mark privileged, privilege log)",
        "Federated review remote — Native Federation",
        "Multi-agent orchestrator: collection + review specialists",
        "Three-pane UI: sidebar nav · routed pages · collapsible chat rail",
        "Documents page with sortable table + filters + slide-in drawer",
        "Audit trail page with action-family filters + JSON state-diff",
        "Click-to-navigate: tool-result widgets dispatch openX actions",
        "5 personas with allow-listed tools (Phase 7 permission shim)",
    ], size=11, gap=4)

    rounded(s, Inches(8.85), Inches(2.4), Inches(3.85), Inches(4.6),
            BRAND_TINT, line=BORDER, radius=0.04)
    text_box(s, Inches(9.0), Inches(2.55), Inches(3.55), Inches(0.4),
             "By the numbers", size=13, bold=True, color=BRAND_DEEP)
    nums = [
        ("28 days",  "for one contributor (Phases 0–7)"),
        ("9 tools",  "across 2 specialists"),
        ("44 KB",    "initial transfer (gzip 15 KB)"),
        ("13 spans", "instrumented per turn"),
        ("5 routes", "lazy-loaded · ~3-9 KB each"),
    ]
    y = Inches(3.0)
    for big, small in nums:
        text_box(s, Inches(9.0), y, Inches(3.55), Inches(0.4),
                 big, size=18, bold=True, color=BRAND_DEEP)
        text_box(s, Inches(9.0), y + Inches(0.4), Inches(3.55), Inches(0.4),
                 small, size=10, color=MUTED)
        y += Inches(0.78)
    add_speaker_notes(s,
        "The eDiscovery demo is the headline. Production-grade patterns, not a prototype.",
        "Acceptable for demos to senior counsel, security review boards, and engineering leadership.")
    return s


# ── Decision matrix + benefits ──────────────────────────────────────────────

def slide_when_to_use_what(prs):
    s = add(prs)
    slide_chrome(s, "7 · DECISIONS", "When to use what — a guide")

    rows = [
        ("Single-app · regulated · audit-heavy",            "AG-UI",   BRAND),
        ("Multi-provider eval · rapid prototype",           "Hashbrown", OK),
        ("Agent navigates / fills forms / mutates store",   "A2UI (over AG-UI base)", WARN),
        ("Multiple teams · independent deploys",            "MFE federation",   INFO),
        ("Analyst desktops · IDE-native agents",            "MCP server",       BAD),
        ("Compliance + chain of custody",                   "Telemetry sink → audit log", BRAND_DEEP),
    ]
    rounded(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            SURFACE, line=BORDER, radius=0.02)
    rect(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.45), SURFACE_2)
    text_box(s, Inches(0.95), Inches(1.78), Inches(8.0), Inches(0.4),
             "Use case", size=11, bold=True, color=MUTED)
    text_box(s, Inches(9.0), Inches(1.78), Inches(3.5), Inches(0.4),
             "Reach for", size=11, bold=True, color=MUTED)
    y = Inches(2.3)
    for use, pick, color in rows:
        text_box(s, Inches(0.95), y + Inches(0.1), Inches(8.0), Inches(0.5),
                 use, size=13, color=TEXT)
        chip(s, Inches(9.0), y + Inches(0.15), pick,
             fg=SURFACE, bg=color, size=11, w=Inches(3.6))
        y += Inches(0.78)
    add_speaker_notes(s,
        "Don't try to pick one protocol. Pick by use case — the library lets you mix.")
    return s


def slide_benefits_execs(prs):
    s = add(prs)
    slide_chrome(s, "8 · BENEFITS", "For senior executives", "Senior executives")

    items = [
        ("Faster time-to-pilot.", "ng add → working chat in 2 minutes. 6 months of in-house plumbing avoided."),
        ("Vendor agnosticism.", "AG-UI today, Hashbrown tomorrow, A2UI when it ships v1 — same UI, swap the backend."),
        ("Regulated-domain ready.", "Audit-grade telemetry, persona scopes, MCP for analysts — built in, not bolted on."),
        ("Microfrontend native.", "Multiple teams contribute capabilities into one chat — federation is a first-class seam."),
        ("Open license.", "MIT. No SaaS lock-in. Internal forking encouraged."),
        ("Reference implementations.", "Six demos including a full eDiscovery app. Blueprint, not a brochure."),
    ]
    bullets(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            items, size=14, gap=12)
    add_speaker_notes(s, "Exec talk track. Six bullets, nothing technical — focus on derisking and time-to-value.")
    return s


def slide_benefits_architects(prs):
    s = add(prs)
    slide_chrome(s, "8 · BENEFITS", "For architects", "Architects")

    items = [
        ("Clean seams.", "AgenticBackend, MfeRegistrySource, Registry<TDef>, AgenticTelemetrySink — every contingency leans on one already in place."),
        ("Conformance-tested adapters.", "/testing entry runs the same suite against every backend; capability flags drive feature-detection."),
        ("Conflict policies + onDispose.", "Multiple teams may register the same tool name; namespace policies coexist; cleanup is automatic."),
        ("Observability by default.", "Distributed tracing across SSE; metrics; logs with trace_id correlation; opt-in OTel exporter."),
        ("Two federation paths.", "Native + Module Federation — no second-class citizen; same CapabilityModule shape; pick by bundler."),
        ("ADRs documented.", "Six ADRs cover backend abstraction, MCP, federation, conflict policies — context for future decisions."),
    ]
    bullets(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            items, size=13, gap=10)
    add_speaker_notes(s, "Architect framing. Highlight that every risk in §11 of the plan has a documented detection signal + contingency.")
    return s


def slide_benefits_devs(prs):
    s = add(prs)
    slide_chrome(s, "8 · BENEFITS", "For developers", "Developers")

    items = [
        ("Schematics.", "ng add bootstraps an entire workspace. ng g …:tool/widget/backend cuts hours of typing per artefact."),
        ("Signal-first APIs.", "ToolRegistry.signal(), CapabilityRegistry.signal() — reactive everywhere; OnPush by default."),
        ("Strict TypeScript.", "Zod-anchored payloads; tool args + props inferred; no any in the public API surface."),
        ("Testing harness.", "FakeAgenticBackend + harnessChat() in /testing; in-memory AgenticTelemetrySink with custom matchers."),
        ("Cookbook entries.", "Every milestone ships a how-to guide — federation at scale, MCP server, observability, persona scopes."),
        ("Live reload across MFEs.", "Both Native + Module Federation play nice with the dev server."),
    ]
    bullets(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            items, size=13, gap=10)
    add_speaker_notes(s, "Dev framing. Show the schematics demo at the end — typically the moment that lands the pitch.")
    return s


# ── Roadmap + CTA ───────────────────────────────────────────────────────────

def slide_roadmap(prs):
    s = add(prs)
    slide_chrome(s, "9 · ROADMAP", "Phased delivery — M1 to v1.0", "Architects")

    rows = [
        ("M1", "AG-UI parity",       "ToolRegistry, ComponentRegistry, BackendRegistry, ChatShell, /testing", OK),
        ("M2", "Schematics",         "ng-add, tool, widget, backend, agent-server, snapshot tests",            OK),
        ("M3", "MFE + A2UI + MCP",   "CapabilityRegistry, MfeRegistry, A2uiBackend, both federation paths",   OK),
        ("M4", "Hashbrown + Extended", "ActionRegistry, IntentRegistry, FormRegistry, ValidationRegistry",    INFO),
        ("M5", "Polish + governance","DataSource/Persistence/Layout/SchemaTransformer · MCP · v1.0 release",   WARN),
    ]
    rounded(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(5.4),
            SURFACE, line=BORDER, radius=0.02)
    rect(s, Inches(0.7), Inches(1.7), W - Inches(1.4), Inches(0.45), SURFACE_2)
    text_box(s, Inches(0.95), Inches(1.78), Inches(0.6), Inches(0.4),
             "M", size=11, bold=True, color=MUTED)
    text_box(s, Inches(1.7), Inches(1.78), Inches(3.0), Inches(0.4),
             "Theme", size=11, bold=True, color=MUTED)
    text_box(s, Inches(5.0), Inches(1.78), Inches(7.0), Inches(0.4),
             "Ships", size=11, bold=True, color=MUTED)
    y = Inches(2.3)
    for m, theme, ships, color in rows:
        rounded(s, Inches(0.95), y + Inches(0.05), Inches(0.6), Inches(0.6),
                color, radius=0.5)
        text_box(s, Inches(0.95), y + Inches(0.05), Inches(0.6), Inches(0.6),
                 m, size=14, bold=True, color=SURFACE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text_box(s, Inches(1.7), y + Inches(0.18), Inches(3.2), Inches(0.5),
                 theme, size=13, bold=True, color=TEXT)
        text_box(s, Inches(5.0), y + Inches(0.18), Inches(7.5), Inches(0.5),
                 ships, size=11, color=TEXT_2)
        y += Inches(0.86)
    add_speaker_notes(s, "Show this slide to architects evaluating maturity. M1-M3 shipped; M4-M5 in flight.")
    return s


def slide_cta(prs):
    s = add(prs)
    rect(s, Inches(0), Inches(0), W, H, RGBColor(0x0F, 0x17, 0x2A))
    rect(s, Inches(8), Inches(0), Inches(5.5), H, RGBColor(0x1E, 0x1B, 0x4B))

    text_box(s, Inches(0.8), Inches(0.85), Inches(11), Inches(0.5),
             "10 · CALL TO ACTION", size=11, bold=True, color=BRAND_TINT)
    text_box(s, Inches(0.8), Inches(1.4), Inches(11), Inches(1.0),
             "Where you can plug in", size=40, bold=True, color=SURFACE)

    rows = [
        ("Senior executives", "Authorise a 2-week pilot — agentic chat in your most-used internal app.",
         "Faster than buying."),
        ("Architects",        "Read ADR-006 (MCP) + ADR-007 (eDiscovery). Spike a remote in your repo.",
         "Conformance suite + cookbook ship in /testing."),
        ("Developers",        "ng add @maverick/agentic-ui. ng g …:tool. ng serve. Done.",
         "30 minutes from clone to working chat."),
    ]
    y = Inches(2.6)
    for who, do, why in rows:
        rounded(s, Inches(0.8), y, Inches(11.5), Inches(1.2),
                RGBColor(0x1E, 0x1B, 0x4B), radius=0.04)
        text_box(s, Inches(1.0), y + Inches(0.18), Inches(2.4), Inches(0.4),
                 who, size=12, bold=True, color=BRAND_TINT)
        text_box(s, Inches(3.5), y + Inches(0.13), Inches(7.0), Inches(0.5),
                 do, size=14, bold=True, color=SURFACE)
        text_box(s, Inches(3.5), y + Inches(0.6), Inches(7.0), Inches(0.4),
                 why, size=11, color=RGBColor(0xC7, 0xD2, 0xFE))
        y += Inches(1.4)

    text_box(s, Inches(0.8), H - Inches(0.85), Inches(11), Inches(0.4),
             "Repository · examples · cookbook · ADRs included.   Questions? Reach the team.",
             size=11, color=FAINT, align=PP_ALIGN.CENTER)
    add_speaker_notes(s, "Closing slide. Three asks per audience. Short, concrete, low-friction.")
    return s


def slide_resources(prs):
    s = add(prs)
    slide_chrome(s, "RESOURCES", "Where to go from here")

    text_box(s, Inches(0.7), Inches(1.7), Inches(5.5), Inches(0.4),
             "Repository layout", size=14, bold=True, color=BRAND_DEEP)
    code_block(s, Inches(0.7), Inches(2.15), Inches(5.7), Inches(4.6), [
        "ag_ui_maverick/",
        "├── projects/",
        "│   ├── agentic-ui/         # publishable lib",
        "│   ├── agentic-ui-server/  # Node companion",
        "│   └── agentic-ui-mcp/     # MCP adapter",
        "├── examples/",
        "│   ├── demo-monolith/",
        "│   ├── demo-shell/  (host)",
        "│   ├── demo-remote-bookings/",
        "│   ├── demo-multi-agent/",
        "│   ├── demo-mcp-server/",
        "│   └── demo-ediscovery-{shared,server,shell,review}/",
        "├── docs/",
        "│   ├── adr/                # decision records",
        "│   ├── cookbook/           # how-to guides",
        "│   └── architecture/       # system docs",
        "└── PLAN.md                 # full roadmap",
    ])

    text_box(s, Inches(6.7), Inches(1.7), Inches(6.0), Inches(0.4),
             "Recommended reading order", size=14, bold=True, color=BRAND_DEEP)
    items = [
        ("README.md",            "5-minute orientation"),
        ("PLAN.md",              "Full architecture + 5-tier registry model"),
        ("ADR-006",              "MCP server-side adapter design"),
        ("docs/cookbook/",       "How-to guides for federation, MCP, OTel"),
        ("examples/demo-feature-tour", "All 13 registries in one app"),
        ("examples/demo-ediscovery",   "Enterprise reference"),
        ("@maverick/agentic-ui/testing", "Conformance suite + harness"),
    ]
    bullets(s, Inches(6.7), Inches(2.15), Inches(6.0), Inches(4.6),
            items, size=12, gap=8)
    add_speaker_notes(s, "Last slide. Hand-off to the audience — every box on the left has its own README.")
    return s


# ── Compose ─────────────────────────────────────────────────────────────────

def main():
    prs = Presentation()
    prs.slide_width = W
    prs.slide_height = H

    builders = [
        slide_cover,
        slide_agenda,
        # Section 1
        slide_shift,
        slide_why_now,
        slide_three_protocols,
        # Section 2 — AG-UI
        slide_agui_background,
        slide_agui_events,
        slide_agui_capabilities,
        # Section 3 — Hashbrown
        slide_hashbrown_background,
        slide_hashbrown_features,
        slide_hashbrown_vs_agui,
        # Section 4 — A2UI
        slide_a2ui,
        # Section 5 — The library
        slide_lib_problem,
        slide_lib_architecture,
        slide_lib_registries,
        slide_lib_backend,
        slide_lib_mfe,
        slide_lib_mcp,
        slide_lib_telemetry,
        slide_lib_schematics,
        # Section 6 — Examples
        slide_examples_overview,
        slide_example_ediscovery,
        # Section 7 — Decisions
        slide_when_to_use_what,
        # Section 8 — Benefits
        slide_benefits_execs,
        slide_benefits_architects,
        slide_benefits_devs,
        # Section 9 — Roadmap
        slide_roadmap,
        # Section 10 — CTA + resources
        slide_cta,
        slide_resources,
    ]

    sections = {
        0:  "Cover", 1: "Agenda",
        2:  "1 · The shift",   3: "1 · The shift",   4: "1 · The shift",
        5:  "2 · AG-UI",       6: "2 · AG-UI",       7: "2 · AG-UI",
        8:  "3 · Hashbrown",   9: "3 · Hashbrown",   10: "3 · Hashbrown",
        11: "4 · A2UI",
        12: "5 · The library", 13: "5 · The library", 14: "5 · The library",
        15: "5 · The library", 16: "5 · The library", 17: "5 · The library",
        18: "5 · The library", 19: "5 · The library",
        20: "6 · Examples",    21: "6 · Examples",
        22: "7 · Decisions",
        23: "8 · Benefits",    24: "8 · Benefits",   25: "8 · Benefits",
        26: "9 · Roadmap",
        27: "10 · Call to action",
        28: "Resources",
    }

    total = len(builders)
    for i, b in enumerate(builders):
        slide = b(prs)
        if i not in (0, 27):                      # skip footer on cover/CTA dark slides
            slide_footer(slide, i + 1, total, sections.get(i, ""))

    prs.save(OUT)
    print(f"Wrote {OUT}  ({total} slides)")


if __name__ == "__main__":
    main()
