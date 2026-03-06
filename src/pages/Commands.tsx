import { useState, useEffect, useCallback } from "react";
import { useCommandStore } from "@/stores/commandStore";
import { Command } from "@tauri-apps/plugin-shell";
import * as tauri from "@/lib/tauri";
import type { CommandDef, CommandParam, MonitoredRepo, PrDetail } from "@/lib/types";
import {
  Plus,
  Zap,
  Play,
  Pencil,
  Trash2,
  X,
  Loader2,
  Shield,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const emptyCommand: CommandDef = {
  id: null,
  slug: "",
  name: "",
  description: "",
  category: "custom",
  prompt_template: "",
  execution_method: "claude-cli",
  parameters_json: "[]",
  is_builtin: false,
  enabled: true,
  created_at: "",
  updated_at: "",
};

const categoryColors: Record<string, string> = {
  review: "bg-blue-500/10 text-blue-400",
  report: "bg-green-500/10 text-green-400",
  custom: "bg-purple-500/10 text-purple-400",
};

export function Commands() {
  const { commands, loading, fetchCommands, saveCommand, deleteCommand } =
    useCommandStore();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<CommandDef | null>(null);
  const [running, setRunning] = useState<CommandDef | null>(null);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  const filtered =
    filter === "all"
      ? commands
      : commands.filter((c) => c.category === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Commands</h2>
          <p className="text-sm text-muted-foreground">
            Manage and run reusable workflow templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              await tauri.resetBuiltinCommands();
              fetchCommands();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
            title="Reset builtin commands to their original defaults"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Defaults
          </button>
          <button
            onClick={() => setEditing({ ...emptyCommand })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Command
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-1">
        {["all", "review", "report", "custom"].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-colors capitalize",
              filter === cat
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No commands found
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((cmd) => (
            <div
              key={cmd.id}
              className="rounded-lg border bg-card p-4 space-y-2"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">{cmd.name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  {cmd.is_builtin && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      builtin
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded capitalize",
                      categoryColors[cmd.category] || categoryColors.custom,
                    )}
                  >
                    {cmd.category}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {cmd.description}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-muted-foreground">
                  {cmd.execution_method}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setRunning(cmd)}
                    className="p-1 rounded hover:bg-secondary transition-colors"
                    title="Run"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditing({ ...cmd })}
                    className="p-1 rounded hover:bg-secondary transition-colors"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {!cmd.is_builtin && (
                    <button
                      onClick={() => cmd.id && deleteCommand(cmd.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditorModal
          command={editing}
          onSave={async (cmd) => {
            await saveCommand(cmd);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {running && (
        <RunnerModal command={running} onClose={() => setRunning(null)} />
      )}
    </div>
  );
}

// ── Editor Modal ──

function EditorModal({
  command,
  onSave,
  onClose,
}: {
  command: CommandDef;
  onSave: (cmd: CommandDef) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CommandDef>({ ...command });
  const [params, setParams] = useState<CommandParam[]>(() => {
    try {
      return JSON.parse(command.parameters_json);
    } catch {
      return [];
    }
  });
  const [saving, setSaving] = useState(false);

  const set = (fields: Partial<CommandDef>) =>
    setForm((f) => ({ ...f, ...fields }));

  const handleSave = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    await onSave({
      ...form,
      parameters_json: JSON.stringify(params),
      slug: form.slug || form.name.toLowerCase().replace(/\s+/g, "-"),
      created_at: form.created_at || now,
      updated_at: now,
    });
    setSaving(false);
  };

  const addParam = () =>
    setParams((p) => [
      ...p,
      { key: "", label: "", type: "text", required: false },
    ]);

  const removeParam = (i: number) =>
    setParams((p) => p.filter((_, idx) => idx !== i));

  const updateParam = (i: number, fields: Partial<CommandParam>) =>
    setParams((p) => p.map((param, idx) => (idx === i ? { ...param, ...fields } : param)));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {command.id ? "Edit Command" : "New Command"}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Slug</label>
            <input
              value={form.slug}
              onChange={(e) => set({ slug: e.target.value })}
              placeholder="auto-generated"
              className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Category</label>
            <select
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
              className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
            >
              <option value="review">Review</option>
              <option value="report">Report</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Execution Method
            </label>
            <select
              value={form.execution_method}
              onChange={(e) => set({ execution_method: e.target.value })}
              className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
            >
              <option value="claude-cli">Claude CLI</option>
              <option value="composite">Composite</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Description</label>
          <input
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Prompt Template
            <span className="ml-2 text-[10px]">
              {'Use {{variable}} for parameter substitution'}
            </span>
          </label>
          <textarea
            value={form.prompt_template}
            onChange={(e) => set({ prompt_template: e.target.value })}
            rows={8}
            className="w-full text-xs font-mono rounded-md border bg-background px-2 py-1.5 resize-y"
          />
        </div>

        {/* Parameter builder */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">Parameters</label>
            <button
              onClick={addParam}
              className="text-xs text-primary hover:underline"
            >
              + Add Parameter
            </button>
          </div>
          {params.map((param, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 mb-2 items-center"
            >
              <input
                value={param.key}
                onChange={(e) => updateParam(i, { key: e.target.value })}
                placeholder="key"
                className="text-xs rounded border bg-background px-2 py-1"
              />
              <input
                value={param.label}
                onChange={(e) => updateParam(i, { label: e.target.value })}
                placeholder="label"
                className="text-xs rounded border bg-background px-2 py-1"
              />
              <select
                value={param.type}
                onChange={(e) =>
                  updateParam(i, { type: e.target.value as CommandParam["type"] })
                }
                className="text-xs rounded border bg-background px-1 py-1"
              >
                <option value="text">Text</option>
                <option value="textarea">Textarea</option>
                <option value="date">Date</option>
                <option value="boolean">Boolean</option>
                <option value="select_monitored_repo">Repo</option>
                <option value="select_pr">PR</option>
              </select>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={param.required}
                  onChange={(e) =>
                    updateParam(i, { required: e.target.checked })
                  }
                />
                Req
              </label>
              <button
                onClick={() => removeParam(i)}
                className="p-0.5 text-destructive hover:bg-destructive/10 rounded"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Runner Modal ──

function RunnerModal({
  command,
  onClose,
}: {
  command: CommandDef;
  onClose: () => void;
}) {
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [repos, setRepos] = useState<MonitoredRepo[]>([]);
  const [prs, setPrs] = useState<PrDetail[]>([]);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [duration, setDuration] = useState<number | null>(null);

  const params: CommandParam[] = (() => {
    try {
      return JSON.parse(command.parameters_json);
    } catch {
      return [];
    }
  })();

  // Initialize defaults
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const p of params) {
      if (p.default) defaults[p.key] = p.default;
    }
    setParamValues(defaults);
  }, [command.parameters_json]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load repos for select_monitored_repo params
  useEffect(() => {
    if (params.some((p) => p.type === "select_monitored_repo")) {
      tauri.getMonitoredRepos().then(setRepos).catch(console.error);
    }
  }, [command.parameters_json]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch PRs when repo changes
  const fetchPrs = useCallback(async (repoName: string) => {
    if (!repoName) return;
    try {
      const cmd = Command.create("gh", [
        "pr", "list", "--repo", repoName,
        "--json", "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles,author,commits",
        "--limit", "20",
      ]);
      const out = await cmd.execute();
      if (out.code === 0) {
        const parsed = JSON.parse(out.stdout);
        setPrs(
          parsed.map((p: Record<string, unknown>) => ({
            number: p.number,
            title: p.title,
            url: p.url,
            state: p.state,
            headRefName: p.headRefName,
            baseRefName: p.baseRefName,
            additions: p.additions,
            deletions: p.deletions,
            changedFiles: p.changedFiles,
            author: p.author ?? { login: "" },
            commits: p.commits ?? { totalCount: 0 },
          })),
        );
      }
    } catch (e) {
      console.error("Failed to fetch PRs:", e);
    }
  }, []);

  const setParam = (key: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [key]: value }));
    // If a repo was selected, load PRs for dependent fields
    const param = params.find((p) => p.key === key);
    if (param?.type === "select_monitored_repo") {
      fetchPrs(value);
    }
  };

  const run = async () => {
    setStatus("running");
    setOutput("");
    setDuration(null);
    const start = Date.now();

    // Create run record
    let runId: number | null = null;
    try {
      runId = await tauri.createCommandRun(
        command.id!,
        JSON.stringify(paramValues),
      );
    } catch {
      // non-critical
    }

    try {
      // Build the prompt by substituting variables
      let prompt = command.prompt_template;
      for (const [key, val] of Object.entries(paramValues)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
      }

      if (command.execution_method === "claude-cli") {
        const cmd = Command.create(
          "claude",
          ["-p", prompt, "--output-format", "text"],
          { env: { CLAUDECODE: "" } },
        );
        const result = await cmd.execute();
        const elapsed = Date.now() - start;
        setDuration(elapsed);

        if (result.code === 0) {
          setOutput(result.stdout);
          setStatus("done");
          if (runId) {
            await tauri.updateCommandRun(runId, "completed", result.stdout, "", elapsed);
          }
        } else {
          setOutput(result.stderr || "Command failed");
          setStatus("error");
          if (runId) {
            await tauri.updateCommandRun(runId, "error", "", result.stderr, elapsed);
          }
        }
      } else {
        setOutput("Composite commands are run programmatically from the PR Review tab.");
        setStatus("done");
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      setDuration(elapsed);
      setOutput(`Error: ${e}`);
      setStatus("error");
      if (runId) {
        await tauri.updateCommandRun(runId, "error", "", String(e), elapsed);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">{command.name}</h3>
            <p className="text-xs text-muted-foreground">{command.description}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dynamic parameter form */}
        {params.length > 0 && (
          <div className="space-y-3">
            {params.map((p) => (
              <div key={p.key}>
                <label className="text-xs text-muted-foreground block mb-1">
                  {p.label}
                  {p.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                {p.type === "select_monitored_repo" ? (
                  <select
                    value={paramValues[p.key] || ""}
                    onChange={(e) => setParam(p.key, e.target.value)}
                    className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
                  >
                    <option value="">Select repository...</option>
                    {repos.map((r) => (
                      <option key={r.full_name} value={r.full_name}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                ) : p.type === "select_pr" ? (
                  <select
                    value={paramValues[p.key] || ""}
                    onChange={(e) => setParam(p.key, e.target.value)}
                    className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
                  >
                    <option value="">Select PR...</option>
                    {prs.map((pr) => (
                      <option key={pr.number} value={String(pr.number)}>
                        #{pr.number} — {pr.title}
                      </option>
                    ))}
                  </select>
                ) : p.type === "textarea" ? (
                  <textarea
                    value={paramValues[p.key] || ""}
                    onChange={(e) => setParam(p.key, e.target.value)}
                    rows={4}
                    className="w-full text-sm font-mono rounded-md border bg-background px-2 py-1.5 resize-y"
                  />
                ) : p.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={paramValues[p.key] === "true"}
                      onChange={(e) =>
                        setParam(p.key, e.target.checked ? "true" : "false")
                      }
                      className="rounded"
                    />
                    {p.label}
                  </label>
                ) : p.type === "date" ? (
                  <input
                    type="date"
                    value={paramValues[p.key] || ""}
                    onChange={(e) => setParam(p.key, e.target.value)}
                    className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
                  />
                ) : (
                  <input
                    value={paramValues[p.key] || ""}
                    onChange={(e) => setParam(p.key, e.target.value)}
                    className="w-full text-sm rounded-md border bg-background px-2 py-1.5"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={run}
          disabled={status === "running"}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {status === "running" ? "Running..." : "Run"}
        </button>

        {/* Output */}
        {output && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span
                className={cn(
                  "text-xs font-medium",
                  status === "done" && "text-green-500",
                  status === "error" && "text-destructive",
                )}
              >
                {status === "done" ? "Completed" : status === "error" ? "Error" : "Output"}
              </span>
              {duration !== null && (
                <span className="text-[10px] text-muted-foreground">
                  {(duration / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            <pre className="text-xs font-mono bg-secondary p-3 rounded max-h-80 overflow-y-auto whitespace-pre-wrap">
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
