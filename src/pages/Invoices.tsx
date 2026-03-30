import { useState, useEffect, useCallback } from "react";
import { useInvoiceStore } from "@/stores/invoiceStore";
import { InvoiceProfileEditor } from "@/components/InvoiceProfileEditor";
import { getCredential } from "@/lib/credentials";
import { fetchKimaiTimesheets, getSettings, updateSetting } from "@/lib/tauri";
import {
  Plus,
  Trash2,
  Download,
  Eye,
  Save,
  RefreshCw,
  FileText,
  Clock,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InvoiceProfile } from "@/lib/types";
import type { InvoicePdfProps } from "@/components/InvoicePdfDocument";
import { getCurrentTimezoneOffset } from "@/lib/timezone";

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function useMonthOptions() {
  const options: { value: string; label: string; begin: string; end: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const begin = formatLocalDate(new Date(y, m, 1));
    const end = formatLocalDate(new Date(y, m + 1, 0));
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    options.push({ value: `${y}-${String(m + 1).padStart(2, "0")}`, label, begin, end });
  }
  return options;
}

export function Invoices() {
  const store = useInvoiceStore();
  const monthOptions = useMonthOptions();

  const [showPreview, setShowPreview] = useState(false);
  const [profileEditorType, setProfileEditorType] = useState<"sender" | "recipient" | null>(null);
  const [editingProfile, setEditingProfile] = useState<InvoiceProfile | null>(null);
  const [importMonth, setImportMonth] = useState(monthOptions[0].value);
  const [importing, setImporting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSenderDropdown, setShowSenderDropdown] = useState(false);
  const [showRecipientDropdown, setShowRecipientDropdown] = useState(false);
  const [defaultRate, setDefaultRate] = useState<number | null>(null);

  useEffect(() => {
    store.fetchProfiles();
    store.fetchInvoices();
    getSettings().then((settings) => {
      const saved = settings.find((s) => s.key === "invoice_default_rate");
      if (saved && saved.value) setDefaultRate(parseFloat(saved.value));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load defaults when profiles are fetched
  useEffect(() => {
    if (!store.senderProfileId && store.senderProfiles.length > 0) {
      const def = store.senderProfiles.find((p) => p.is_default) ?? store.senderProfiles[0];
      store.loadFromProfile(def);
    }
    if (!store.recipientProfileId && store.recipientProfiles.length > 0) {
      const def = store.recipientProfiles.find((p) => p.is_default) ?? store.recipientProfiles[0];
      store.loadFromProfile(def);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.senderProfiles.length, store.recipientProfiles.length]);

  const handleImportKimai = async () => {
    setImporting(true);
    try {
      const url = await getCredential("kimai_url");
      const token = await getCredential("kimai_token");
      if (!url || !token) {
        alert("Kimai credentials not configured. Go to Connections first.");
        return;
      }
      const mo = monthOptions.find((o) => o.value === importMonth)!;
      const tz = getCurrentTimezoneOffset();
      const nextDay = new Date(new Date(mo.end + "T00:00:00").getTime() + 86400000).toISOString().split("T")[0];
      const timesheets = await fetchKimaiTimesheets(url, token, `${mo.begin}T00:00:00${tz}`, `${nextDay}T00:00:00${tz}`);
      const totalSeconds = timesheets.reduce((sum, ts) => sum + (ts.duration ?? 0), 0);
      const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;

      const rate = defaultRate ?? 0;
      store.setField("lineItems", [
        ...store.lineItems.filter((i) => i.description),
        {
          description: `Software development services performed in Brazil — ${mo.label}`,
          quantity: totalHours,
          rate,
          amount: rate ? Math.round(totalHours * rate * 100) / 100 : 0,
        },
      ]);
    } catch (e) {
      console.error("Kimai import failed:", e);
      alert(`Import failed: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await store.saveInvoice();
    } catch (e) {
      console.error("Save failed:", e);
      alert(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const buildPdfProps = useCallback((): InvoicePdfProps => ({
    invoiceNumber: store.invoiceNumber,
    invoiceDate: store.invoiceDate,
    dueDate: store.dueDate,
    currency: store.currency,
    senderInfo: store.senderInfo,
    recipientInfo: store.recipientInfo,
    termsInfo: store.termsInfo,
    lineItems: store.lineItems.filter((i) => i.description),
    subtotal: store.subtotal(),
    taxRate: store.taxRate,
    taxAmount: store.taxAmount(),
    total: store.total(),
  }), [store]);

  const inputClass = "w-full px-2 py-1 text-sm bg-background border rounded focus:outline-none focus:ring-1 focus:ring-primary";
  const labelClass = "text-[10px] text-muted-foreground uppercase tracking-wide";

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Invoices</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-muted", showHistory && "bg-muted")}
          >
            <Clock className="h-3.5 w-3.5" /> History
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-muted", showPreview && "bg-muted")}
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save"}
          </button>
          <DownloadButton buildPdfProps={buildPdfProps} invoiceNumber={store.invoiceNumber} />
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="mb-4 p-3 border rounded-lg bg-card">
          <h3 className="text-xs font-medium mb-2">Saved Invoices</h3>
          {store.invoices.length === 0 ? (
            <p className="text-xs text-muted-foreground">No invoices saved yet.</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {store.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted rounded">
                  <button onClick={() => store.loadInvoice(inv)} className="flex items-center gap-2 flex-1 text-left">
                    <span className="font-mono">#{inv.invoice_number}</span>
                    <span className="text-muted-foreground">{inv.invoice_date}</span>
                    <span className="text-muted-foreground">{inv.currency} {inv.total.toFixed(2)}</span>
                  </button>
                  <button onClick={() => inv.id && store.deleteInvoice(inv.id)} className="p-1 hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={cn("flex-1 min-h-0", showPreview ? "grid grid-cols-2 gap-4" : "")}>
        {/* Form */}
        <div className={cn("overflow-y-auto space-y-4 pr-1", showPreview ? "" : "max-w-3xl")}>
          {/* Invoice Meta */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className={labelClass}>Invoice #</label>
              <input className={inputClass} value={store.invoiceNumber} onChange={(e) => store.setField("invoiceNumber", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input type="date" className={inputClass} value={store.invoiceDate} onChange={(e) => store.setField("invoiceDate", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Due Date</label>
              <input type="date" className={inputClass} value={store.dueDate} onChange={(e) => store.setField("dueDate", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Currency</label>
              <select className={inputClass} value={store.currency} onChange={(e) => store.setField("currency", e.target.value)}>
                <option value="USD">USD (US$)</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>

          {/* From / Bill To */}
          <div className="grid grid-cols-2 gap-4">
            {/* Sender */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className={labelClass}>From (Sender)</span>
                <ProfileDropdown
                  profiles={store.senderProfiles}
                  show={showSenderDropdown}
                  onToggle={() => setShowSenderDropdown(!showSenderDropdown)}
                  onSelect={(p) => { store.loadFromProfile(p); setShowSenderDropdown(false); }}
                  onNew={() => { setProfileEditorType("sender"); setEditingProfile(null); }}
                />
              </div>
              <textarea
                className={`${inputClass} min-h-[120px] resize-y`}
                placeholder={"Company Name\nTax ID: 000000000\nStreet, 123\nCity, State\nCountry — Postal Code"}
                value={store.senderInfo}
                onChange={(e) => store.setField("senderInfo", e.target.value)}
              />
              {store.senderProfileId && (
                <button onClick={() => store.saveAsProfile("sender")} className="text-[10px] text-primary hover:underline">
                  Update Profile
                </button>
              )}
            </div>

            {/* Recipient */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className={labelClass}>Bill To (Recipient)</span>
                <ProfileDropdown
                  profiles={store.recipientProfiles}
                  show={showRecipientDropdown}
                  onToggle={() => setShowRecipientDropdown(!showRecipientDropdown)}
                  onSelect={(p) => { store.loadFromProfile(p); setShowRecipientDropdown(false); }}
                  onNew={() => { setProfileEditorType("recipient"); setEditingProfile(null); }}
                />
              </div>
              <textarea
                className={`${inputClass} min-h-[120px] resize-y`}
                placeholder={"Company Name\nAddress Line 1\nCity, State\nCountry\nVAT ID: XX000000000"}
                value={store.recipientInfo}
                onChange={(e) => store.setField("recipientInfo", e.target.value)}
              />
              {store.recipientProfileId && (
                <button onClick={() => store.saveAsProfile("recipient")} className="text-[10px] text-primary hover:underline">
                  Update Profile
                </button>
              )}
            </div>
          </div>

          {/* Terms / Bank Details */}
          <div className="border rounded-lg p-3 space-y-2">
            <span className={labelClass}>Terms / Bank Details</span>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              placeholder={"Account Type: Checking\nBank Code: 000\nBranch: 0001\nAccount: 1234567-8\nBank Name: Your Bank"}
              value={store.termsInfo}
              onChange={(e) => store.setField("termsInfo", e.target.value)}
            />
          </div>

          {/* Kimai Import */}
          <div className="flex items-center gap-2 p-3 border rounded-lg bg-card">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Import from Kimai:</span>
            <select
              className="px-2 py-1 text-xs bg-background border rounded"
              value={importMonth}
              onChange={(e) => setImportMonth(e.target.value)}
            >
              {monthOptions.map((mo) => (
                <option key={mo.value} value={mo.value}>{mo.label}</option>
              ))}
            </select>
            <button
              onClick={handleImportKimai}
              disabled={importing}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import Hours"}
            </button>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={labelClass}>Line Items</span>
              <button onClick={() => store.addLineItem()} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                <Plus className="h-3 w-3" /> Add Item
              </button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-0 bg-muted px-3 py-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">Description</span>
                <span className="text-[10px] font-medium text-muted-foreground text-right">Qty</span>
                <span className="text-[10px] font-medium text-muted-foreground text-right">Rate</span>
                <span className="text-[10px] font-medium text-muted-foreground text-right">Amount</span>
                <span />
              </div>
              {store.lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-0 px-3 py-1 border-t items-center">
                  <input
                    className="px-1 py-0.5 text-sm bg-transparent border-0 focus:outline-none focus:ring-0"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => store.updateLineItem(i, "description", e.target.value)}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="px-1 py-0.5 text-sm bg-transparent border-0 text-right focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={item.quantity || ""}
                    onChange={(e) => store.updateLineItem(i, "quantity", e.target.value)}
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Rate"
                    className="px-1 py-0.5 text-sm bg-transparent border-0 text-right focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={item.rate || ""}
                    onChange={(e) => {
                      store.updateLineItem(i, "rate", e.target.value);
                      const val = parseFloat(e.target.value);
                      if (val > 0) {
                        setDefaultRate(val);
                        updateSetting("invoice_default_rate", String(val));
                      }
                    }}
                  />
                  <span className="text-sm text-right font-mono">
                    {item.amount ? item.amount.toFixed(2) : "0.00"}
                  </span>
                  <button
                    onClick={() => store.removeLineItem(i)}
                    className="p-1 hover:text-destructive text-muted-foreground"
                    disabled={store.lineItems.length <= 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{store.subtotal().toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Tax</span>
                  <input
                    type="number"
                    step="0.1"
                    className="w-14 px-1 py-0 text-xs bg-background border rounded text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    value={store.taxRate}
                    onChange={(e) => store.setField("taxRate", Number(e.target.value))}
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="font-mono">{store.taxAmount().toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t pt-1">
                <span>Total</span>
                <span className="font-mono">{store.total().toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Reset */}
          <div className="flex justify-start pb-4">
            <button onClick={() => store.reset()} className="text-xs text-muted-foreground hover:text-destructive">
              Reset Form
            </button>
          </div>
        </div>

        {/* Preview Panel */}
        {showPreview && (
          <div className="h-full min-h-[500px]">
            <PdfPreview buildPdfProps={buildPdfProps} />
          </div>
        )}
      </div>

      {/* Profile Editor Modal */}
      {profileEditorType && (
        <InvoiceProfileEditor
          profile={editingProfile}
          profileType={profileEditorType}
          onSave={() => { setProfileEditorType(null); store.fetchProfiles(); }}
          onClose={() => setProfileEditorType(null)}
        />
      )}
    </div>
  );
}

function ProfileDropdown({ profiles, show, onToggle, onSelect, onNew }: {
  profiles: InvoiceProfile[];
  show: boolean;
  onToggle: () => void;
  onSelect: (p: InvoiceProfile) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-1 relative">
      {profiles.length > 0 && (
        <div className="relative">
          <button onClick={onToggle} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
            Load Profile <ChevronDown className="h-3 w-3" />
          </button>
          {show && (
            <div className="absolute right-0 top-full mt-1 bg-card border rounded shadow-lg z-10 min-w-[160px]">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelect(p)}
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                >
                  {p.name} {p.is_default && "(default)"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={onNew} className="text-[10px] text-primary hover:underline">+ New</button>
    </div>
  );
}

function PdfPreview({ buildPdfProps }: { buildPdfProps: () => InvoicePdfProps }) {
  const [PdfModule, setPdfModule] = useState<{
    PDFViewer: typeof import("@react-pdf/renderer").PDFViewer;
    InvoicePdfDocument: typeof import("@/components/InvoicePdfDocument").InvoicePdfDocument;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      import("@react-pdf/renderer"),
      import("@/components/InvoicePdfDocument"),
    ]).then(([renderer, doc]) => {
      setPdfModule({ PDFViewer: renderer.PDFViewer, InvoicePdfDocument: doc.InvoicePdfDocument });
    });
  }, []);

  if (!PdfModule) return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading PDF renderer...</div>;

  const pdfProps = buildPdfProps();
  return (
    <PdfModule.PDFViewer width="100%" height="100%" className="rounded-md border">
      <PdfModule.InvoicePdfDocument {...pdfProps} />
    </PdfModule.PDFViewer>
  );
}

function DownloadButton({ buildPdfProps, invoiceNumber }: { buildPdfProps: () => InvoicePdfProps; invoiceNumber: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const { InvoicePdfDocument } = await import("@/components/InvoicePdfDocument");
      const pdfProps = buildPdfProps();
      const blob = await pdf(<InvoicePdfDocument {...pdfProps} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice ${invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
      alert(`Download failed: ${e}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-muted disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" /> {downloading ? "Generating..." : "Download PDF"}
    </button>
  );
}
