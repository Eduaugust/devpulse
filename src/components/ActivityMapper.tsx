import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Sparkles,
  Save,
  X,
  Code,
  List,
} from "lucide-react";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import {
  getActivityMappings,
  saveActivityMapping,
  deleteActivityMapping,
  runClaudeCli,
  fetchKimaiTimesheets,
  fetchCalendarEvents,
} from "@/lib/tauri";
import { getCredential } from "@/lib/credentials";
import type { ActivityMapping } from "@/lib/types";

const EMPTY_MAPPING: ActivityMapping = {
  id: null,
  name: "",
  description: "",
  pattern: "",
  pattern_type: "contains",
  kimai_project_id: null,
  kimai_project_name: "",
  kimai_activity_id: null,
  kimai_activity_name: "",
  kimai_tags: "",
  priority: 0,
  enabled: true,
  created_at: "",
  updated_at: "",
};

export function ActivityMapper() {
  const [collapsed, setCollapsed] = useState(true);
  const [mappings, setMappings] = useState<ActivityMapping[]>([]);
  const [editing, setEditing] = useState<ActivityMapping | null>(null);
  const [editingSource, setEditingSource] = useState<
    "new" | "mapping" | { type: "suggestion"; index: number }
  >("new");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestStatus, setSuggestStatus] = useState("");
  const [suggestions, setSuggestions] = useState<ActivityMapping[]>([]);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");

  useEffect(() => {
    loadMappings();
  }, []);

  async function loadMappings() {
    try {
      const m = await getActivityMappings();
      setMappings(m);
    } catch {
      /* ignore */
    }
  }

  async function handleSave() {
    if (!editing) return;
    try {
      await saveActivityMapping(editing);
      // If editing came from a suggestion, remove it from the list
      if (typeof editingSource === "object" && editingSource.type === "suggestion") {
        setSuggestions((prev) => prev.filter((_, j) => j !== editingSource.index));
      }
      setEditing(null);
      await loadMappings();
    } catch (e) {
      console.error("Failed to save mapping:", e);
    }
  }

  function handleCancel() {
    setEditing(null);
  }

  async function handleDelete(id: number) {
    try {
      await deleteActivityMapping(id);
      await loadMappings();
    } catch {
      /* ignore */
    }
  }

  async function handleToggle(m: ActivityMapping) {
    try {
      await saveActivityMapping({ ...m, enabled: !m.enabled });
      await loadMappings();
    } catch {
      /* ignore */
    }
  }

  async function handleAutoSuggest() {
    setSuggesting(true);
    setSuggestions([]);
    setSuggestStatus("Gathering data...");
    try {
      const kimaiUrl = await getCredential("kimai_url");
      const kimaiToken = await getCredential("kimai_token");
      const calCreds = await getCredential("calendar_credentials");
      const calId = await getCredential("calendar_email");

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fmtDate = (d: Date) => d.toISOString().split("T")[0];
      const calFrom = fmtDate(thirtyDaysAgo);
      const calTo = fmtDate(now);
      const kimaiFrom = `${calFrom}T00:00:00`;
      const kimaiTo = `${calTo}T23:59:59`;

      let calData = "";
      let kimaiData = "";
      const errors: string[] = [];

      if (calCreds) {
        setSuggestStatus("Fetching calendar events...");
        try {
          const events = await fetchCalendarEvents(calCreds, calFrom, calTo, calId || undefined);
          calData = events
            .map((e) => `- ${e.summary} (${e.start} to ${e.end})`)
            .join("\n");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Calendar: ${msg}`);
          console.warn("Failed to fetch calendar events:", e);
        }
      } else {
        errors.push("Calendar: no credentials configured");
      }

      if (kimaiUrl && kimaiToken) {
        setSuggestStatus("Fetching Kimai entries...");
        try {
          const entries = await fetchKimaiTimesheets(kimaiUrl, kimaiToken, kimaiFrom, kimaiTo);
          kimaiData = entries
            .map(
              (e) =>
                `- ${(e.project as Record<string, string>)?.name ?? "?"} / ${
                  (e.activity as Record<string, string>)?.name ?? "?"
                } | ${e.description ?? ""}`
            )
            .join("\n");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Kimai: ${msg}`);
          console.warn("Failed to fetch Kimai entries:", e);
        }
      } else {
        errors.push("Kimai: no credentials configured");
      }

      if (!calData && !kimaiData) {
        setSuggestStatus(`No data found. ${errors.join(" | ")}`);
        setSuggesting(false);
        return;
      }

      setSuggestStatus("Asking Claude to analyze patterns...");

      const prompt = `Analyze these calendar events and Kimai timesheet entries to suggest activity mapping rules.

Calendar events (last 30 days):
${calData || "No data"}

Kimai entries (last 30 days):
${kimaiData || "No data"}

Existing mappings:
${mappings.map((m) => `- "${m.pattern}" → ${m.kimai_project_name}/${m.kimai_activity_name}`).join("\n") || "None"}

Generate a JSON array of suggested mappings. Each object should have:
- name: descriptive rule name
- description: short explanation of what this rule does and when it applies
- pattern: text pattern to match calendar events
- pattern_type: "contains" or "starts_with"
- kimai_project_name: suggested project name
- kimai_activity_name: suggested activity name
- kimai_tags: suggested tags (comma-separated)
- priority: 0-10

Only suggest mappings that aren't already covered by existing ones. Return ONLY the JSON array, no other text.`;

      const result = await runClaudeCli(prompt);
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          name: string;
          description?: string;
          pattern: string;
          pattern_type: string;
          kimai_project_name: string;
          kimai_activity_name: string;
          kimai_tags?: string;
          priority?: number;
        }>;
        const suggested: ActivityMapping[] = parsed.map((s) => ({
          ...EMPTY_MAPPING,
          name: s.name || "",
          description: s.description || "",
          pattern: s.pattern || "",
          pattern_type: (s.pattern_type as ActivityMapping["pattern_type"]) || "contains",
          kimai_project_name: s.kimai_project_name || "",
          kimai_activity_name: s.kimai_activity_name || "",
          kimai_tags: s.kimai_tags || "",
          priority: s.priority || 0,
        }));
        setSuggestions(suggested);
        setSuggestStatus(suggested.length > 0 ? "" : "No new suggestions found.");
      } else {
        setSuggestStatus("Could not parse suggestions from Claude response.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSuggestStatus(`Error: ${msg}`);
      console.error("Auto-suggest failed:", e);
    } finally {
      setSuggesting(false);
    }
  }

  async function acceptSuggestion(s: ActivityMapping) {
    try {
      await saveActivityMapping(s);
      setSuggestions((prev) => prev.filter((x) => x.pattern !== s.pattern));
      await loadMappings();
    } catch {
      /* ignore */
    }
  }

  function enterJsonMode() {
    const clean = mappings.map(({ id, created_at, updated_at, ...rest }) => rest);
    setJsonText(JSON.stringify(clean, null, 2));
    setJsonError("");
    setJsonMode(true);
  }

  async function handleJsonSave() {
    try {
      const parsed = JSON.parse(jsonText) as Array<Record<string, unknown>>;
      if (!Array.isArray(parsed)) {
        setJsonError("Must be a JSON array.");
        return;
      }

      // Delete all existing mappings
      for (const m of mappings) {
        if (m.id) await deleteActivityMapping(m.id);
      }

      // Save all from JSON
      for (const item of parsed) {
        const mapping: ActivityMapping = {
          ...EMPTY_MAPPING,
          name: String(item.name ?? ""),
          description: String(item.description ?? ""),
          pattern: String(item.pattern ?? ""),
          pattern_type: (String(item.pattern_type ?? "contains")) as ActivityMapping["pattern_type"],
          kimai_project_id: (item.kimai_project_id as number) ?? null,
          kimai_project_name: String(item.kimai_project_name ?? ""),
          kimai_activity_id: (item.kimai_activity_id as number) ?? null,
          kimai_activity_name: String(item.kimai_activity_name ?? ""),
          kimai_tags: String(item.kimai_tags ?? ""),
          priority: Number(item.priority ?? 0),
          enabled: item.enabled !== false,
        };
        await saveActivityMapping(mapping);
      }

      await loadMappings();
      setJsonMode(false);
      setJsonError("");
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  function renderEditForm() {
    if (!editing) return null;
    return (
      <div className="space-y-2 p-3 rounded border border-primary/30 bg-accent/20">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="Rule name"
            className="px-2 py-1 text-xs rounded border border-border bg-background"
          />
          <select
            value={editing.pattern_type}
            onChange={(e) =>
              setEditing({
                ...editing,
                pattern_type: e.target.value as ActivityMapping["pattern_type"],
              })
            }
            className="px-2 py-1 text-xs rounded border border-border bg-background"
          >
            <option value="contains">Contains</option>
            <option value="exact">Exact</option>
            <option value="starts_with">Starts With</option>
            <option value="regex">Regex</option>
          </select>
        </div>
        <input
          value={editing.description}
          onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          placeholder="Description (e.g. 'Maps 1:1 meetings to coaching activity')"
          className="w-full px-2 py-1 text-xs rounded border border-border bg-background"
        />
        <input
          value={editing.pattern}
          onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
          placeholder="Match pattern (e.g. '1:1', 'standup')"
          className="w-full px-2 py-1 text-xs rounded border border-border bg-background"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={editing.kimai_project_name}
            onChange={(e) =>
              setEditing({ ...editing, kimai_project_name: e.target.value })
            }
            placeholder="Kimai Project Name"
            className="px-2 py-1 text-xs rounded border border-border bg-background"
          />
          <input
            value={editing.kimai_activity_name}
            onChange={(e) =>
              setEditing({ ...editing, kimai_activity_name: e.target.value })
            }
            placeholder="Kimai Activity Name"
            className="px-2 py-1 text-xs rounded border border-border bg-background"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            value={editing.kimai_tags}
            onChange={(e) => setEditing({ ...editing, kimai_tags: e.target.value })}
            placeholder="Tags (comma-sep)"
            className="px-2 py-1 text-xs rounded border border-border bg-background"
          />
          <input
            type="number"
            value={editing.priority}
            onChange={(e) =>
              setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })
            }
            placeholder="Priority"
            className="px-2 py-1 text-xs rounded border border-border bg-background"
          />
          <div className="flex gap-1 justify-end">
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Save className="h-3 w-3" /> Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-secondary text-secondary-foreground"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isEditingSuggestion =
    typeof editingSource === "object" && editingSource.type === "suggestion";

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 p-3 text-sm font-medium text-foreground hover:bg-accent/50 rounded-lg"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        Activity Mappings
        <span className="ml-auto text-xs text-muted-foreground">
          {mappings.filter((m) => m.enabled).length} rules
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Toolbar */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setEditing({ ...EMPTY_MAPPING });
                setEditingSource("new");
              }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" /> Add Rule
            </button>
            <button
              onClick={handleAutoSuggest}
              disabled={suggesting}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              {suggesting ? "Analyzing..." : "Auto-Suggest"}
            </button>
            <button
              onClick={() => {
                if (jsonMode) {
                  setJsonMode(false);
                } else {
                  enterJsonMode();
                }
              }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 ml-auto"
            >
              {jsonMode ? <List className="h-3 w-3" /> : <Code className="h-3 w-3" />}
              {jsonMode ? "List View" : "JSON"}
            </button>
          </div>

          {/* Status */}
          {suggestStatus && (
            <p className="text-xs text-muted-foreground">{suggestStatus}</p>
          )}

          {/* Edit form for new rule (not from suggestion) */}
          {editing && !isEditingSuggestion && editingSource !== "mapping" && renderEditForm()}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Suggestions ({suggestions.length})
              </p>
              {suggestions.map((s, i) => {
                const isEditingThis =
                  editing &&
                  typeof editingSource === "object" &&
                  editingSource.type === "suggestion" &&
                  editingSource.index === i;

                if (isEditingThis) {
                  return <div key={i}>{renderEditForm()}</div>;
                }

                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 rounded bg-accent/30 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.name || s.pattern}</div>
                      {s.description && (
                        <div className="text-muted-foreground truncate">{s.description}</div>
                      )}
                      <div className="text-muted-foreground truncate">
                        "{s.pattern}" ({s.pattern_type}) → {s.kimai_project_name} / {s.kimai_activity_name}
                        {s.kimai_tags && ` [${s.kimai_tags}]`}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setEditing({ ...s });
                          setEditingSource({ type: "suggestion", index: i });
                        }}
                        className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => acceptSuggestion(s)}
                        className="px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-500"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() =>
                          setSuggestions((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* JSON editor */}
          {jsonMode ? (
            <div className="space-y-2">
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError("");
                }}
                spellCheck={false}
                className="w-full h-64 px-3 py-2 text-xs font-mono rounded border border-border bg-background resize-y"
              />
              {jsonError && (
                <p className="text-xs text-destructive">{jsonError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleJsonSave}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Save className="h-3 w-3" /> Save JSON
                </button>
                <button
                  onClick={() => setJsonMode(false)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-secondary text-secondary-foreground"
                >
                  <X className="h-3 w-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Mapping list */}
              {mappings.length === 0 && !editing && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No activity mappings yet. Add rules to map calendar events to Kimai
                  activities.
                </p>
              )}

              {mappings.map((m) => (
                <div key={m.id}>
                  {editing && editingSource === "mapping" && editing.id === m.id ? (
                    renderEditForm()
                  ) : (
                    <div className="flex items-center gap-2 p-2 rounded border border-border text-xs">
                      <ToggleSwitch
                        enabled={m.enabled}
                        onToggle={() => handleToggle(m)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{m.name || m.pattern}</div>
                        {m.description && (
                          <div className="text-muted-foreground truncate">{m.description}</div>
                        )}
                        <div className="text-muted-foreground truncate">
                          "{m.pattern}" ({m.pattern_type}) → {m.kimai_project_name} /{" "}
                          {m.kimai_activity_name}
                          {m.kimai_tags && ` [${m.kimai_tags}]`}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setEditing({ ...m });
                          setEditingSource("mapping");
                        }}
                        className="text-muted-foreground hover:text-foreground px-1"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => m.id && handleDelete(m.id)}
                        className="text-muted-foreground hover:text-destructive px-1"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
