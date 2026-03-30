import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { InvoiceProfile } from "@/lib/types";
import * as commands from "@/lib/tauri";

interface InvoiceProfileEditorProps {
  profile: InvoiceProfile | null;
  profileType: "sender" | "recipient";
  onSave: () => void;
  onClose: () => void;
}

export function InvoiceProfileEditor({ profile, profileType, onSave, onClose }: InvoiceProfileEditorProps) {
  const [name, setName] = useState(profile?.name ?? "");
  const [content, setContent] = useState(profile?.address_line1 ?? "");
  const [terms, setTerms] = useState(
    profile?.bank_details_json && profile.bank_details_json !== "{}" ? profile.bank_details_json : ""
  );
  const [isDefault, setIsDefault] = useState(profile?.is_default ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await commands.saveInvoiceProfile({
        id: profile?.id ?? null,
        profile_type: profileType,
        name,
        tax_number: "",
        address_line1: content,
        address_line2: "",
        city: "",
        state: "",
        country: "",
        postal_code: "",
        bank_details_json: profileType === "sender" ? (terms || "{}") : "{}",
        is_default: isDefault,
        created_at: "",
        updated_at: "",
      });
      onSave();
    } catch (e) {
      console.error("Failed to save profile:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!profile?.id) return;
    await commands.deleteInvoiceProfile(profile.id);
    onSave();
  };

  const inputClass = "w-full px-3 py-1.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm">
            {profile ? "Edit" : "New"} {profileType === "sender" ? "Sender" : "Recipient"} Profile
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Profile Name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Company" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              {profileType === "sender" ? "Sender Info" : "Bill To Info"}
            </label>
            <textarea
              className={`${inputClass} min-h-[100px] resize-y`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"Company Name\nTax ID: 000000000\nStreet Address, 123\nCity, State\nCountry — Postal Code"}
            />
          </div>
          {profileType === "sender" && (
            <div>
              <label className="text-xs text-muted-foreground">Bank Details / Terms</label>
              <textarea
                className={`${inputClass} min-h-[80px] resize-y`}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder={"Account Type: Checking\nBank Code: 000\nBranch: 0001\nAccount: 1234567-8\nBank Name: Your Bank"}
              />
            </div>
          )}
          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
            <span className="text-xs text-muted-foreground">Set as default</span>
          </label>
        </div>

        <div className="flex items-center justify-between p-4 border-t">
          {profile?.id ? (
            <button onClick={handleDelete} className="flex items-center gap-1.5 text-xs text-destructive hover:underline">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs border rounded-md hover:bg-muted">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || !name}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
