import { create } from "zustand";
import type { InvoiceProfile, Invoice, InvoiceLineItem } from "@/lib/types";
import * as commands from "@/lib/tauri";

interface InvoiceFormState {
  senderInfo: string;
  recipientInfo: string;
  termsInfo: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  taxRate: number;
  lineItems: InvoiceLineItem[];
}

interface InvoiceStore extends InvoiceFormState {
  senderProfiles: InvoiceProfile[];
  recipientProfiles: InvoiceProfile[];
  invoices: Invoice[];
  loading: boolean;
  senderProfileId: number | null;
  recipientProfileId: number | null;

  setField: <K extends keyof InvoiceFormState>(key: K, value: InvoiceFormState[K]) => void;

  fetchProfiles: () => Promise<void>;
  loadFromProfile: (profile: InvoiceProfile) => void;
  saveAsProfile: (type: "sender" | "recipient") => Promise<number>;
  deleteProfile: (id: number) => Promise<void>;

  addLineItem: () => void;
  removeLineItem: (index: number) => void;
  updateLineItem: (index: number, field: keyof InvoiceLineItem, value: string | number) => void;

  fetchInvoices: () => Promise<void>;
  saveInvoice: () => Promise<number>;
  loadInvoice: (invoice: Invoice) => Promise<void>;
  deleteInvoice: (id: number) => Promise<void>;

  subtotal: () => number;
  taxAmount: () => number;
  total: () => number;

  reset: () => void;
}

const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const defaultNumber = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

const initialFormState: InvoiceFormState = {
  senderInfo: "",
  recipientInfo: "",
  termsInfo: "",
  invoiceNumber: defaultNumber(),
  invoiceDate: today(),
  dueDate: today(),
  currency: "USD",
  taxRate: 0,
  lineItems: [{ description: "", quantity: 0, rate: 0, amount: 0 }],
};

export const useInvoiceStore = create<InvoiceStore>((set, get) => ({
  ...initialFormState,
  senderProfiles: [],
  recipientProfiles: [],
  invoices: [],
  loading: false,
  senderProfileId: null,
  recipientProfileId: null,

  setField: (key, value) => set({ [key]: value }),

  fetchProfiles: async () => {
    try {
      const all = await commands.getInvoiceProfiles();
      set({
        senderProfiles: all.filter((p) => p.profile_type === "sender"),
        recipientProfiles: all.filter((p) => p.profile_type === "recipient"),
      });
    } catch (e) {
      console.error("Failed to fetch invoice profiles:", e);
    }
  },

  loadFromProfile: (profile) => {
    if (profile.profile_type === "sender") {
      set({
        senderProfileId: profile.id,
        senderInfo: profile.address_line1,
        termsInfo: profile.bank_details_json === "{}" ? "" : profile.bank_details_json,
      });
    } else {
      set({
        recipientProfileId: profile.id,
        recipientInfo: profile.address_line1,
      });
    }
  },

  saveAsProfile: async (type) => {
    const s = get();
    const profile: InvoiceProfile = {
      id: type === "sender" ? s.senderProfileId : s.recipientProfileId,
      profile_type: type,
      name: (type === "sender" ? s.senderInfo : s.recipientInfo).split("\n")[0] || "Untitled",
      tax_number: "",
      address_line1: type === "sender" ? s.senderInfo : s.recipientInfo,
      address_line2: "",
      city: "",
      state: "",
      country: "",
      postal_code: "",
      bank_details_json: type === "sender" ? (s.termsInfo || "{}") : "{}",
      is_default: false,
      created_at: "",
      updated_at: "",
    };
    const id = await commands.saveInvoiceProfile(profile);
    await get().fetchProfiles();
    if (type === "sender") set({ senderProfileId: id });
    else set({ recipientProfileId: id });
    return id;
  },

  deleteProfile: async (id) => {
    await commands.deleteInvoiceProfile(id);
    await get().fetchProfiles();
  },

  addLineItem: () => {
    set((s) => ({
      lineItems: [...s.lineItems, { description: "", quantity: 0, rate: 0, amount: 0 }],
    }));
  },

  removeLineItem: (index) => {
    set((s) => ({
      lineItems: s.lineItems.filter((_, i) => i !== index),
    }));
  },

  updateLineItem: (index, field, value) => {
    set((s) => {
      const items = [...s.lineItems];
      const item = { ...items[index] };
      if (field === "description") {
        item.description = value as string;
      } else {
        item[field] = Number(value);
      }
      if (field === "quantity" || field === "rate") {
        item.amount = item.quantity * item.rate;
      }
      items[index] = item;
      return { lineItems: items };
    });
  },

  fetchInvoices: async () => {
    set({ loading: true });
    try {
      const invoices = await commands.getInvoices();
      set({ invoices, loading: false });
    } catch (e) {
      console.error("Failed to fetch invoices:", e);
      set({ loading: false });
    }
  },

  saveInvoice: async () => {
    const s = get();
    // Auto-create profiles if none selected so FK constraint is satisfied
    let senderId = s.senderProfileId;
    let recipientId = s.recipientProfileId;
    if (!senderId && s.senderInfo) {
      senderId = await get().saveAsProfile("sender");
    }
    if (!recipientId && s.recipientInfo) {
      recipientId = await get().saveAsProfile("recipient");
    }
    const invoice: Invoice = {
      id: null,
      invoice_number: s.invoiceNumber,
      sender_profile_id: senderId ?? 0,
      recipient_profile_id: recipientId ?? 0,
      invoice_date: s.invoiceDate,
      due_date: s.dueDate,
      currency: s.currency,
      line_items_json: JSON.stringify(s.lineItems),
      subtotal: s.subtotal(),
      tax_rate: s.taxRate,
      tax_amount: s.taxAmount(),
      total: s.total(),
      notes: JSON.stringify({ senderInfo: s.senderInfo, recipientInfo: s.recipientInfo, termsInfo: s.termsInfo }),
      status: "final",
      created_at: "",
      updated_at: "",
    };
    const id = await commands.saveInvoice(invoice);
    await get().fetchInvoices();
    return id;
  },

  loadInvoice: async (invoice) => {
    const items: InvoiceLineItem[] = JSON.parse(invoice.line_items_json || "[]");
    let senderInfo = "";
    let recipientInfo = "";
    let termsInfo = "";
    try {
      const notes = JSON.parse(invoice.notes || "{}");
      senderInfo = notes.senderInfo || "";
      recipientInfo = notes.recipientInfo || "";
      termsInfo = notes.termsInfo || "";
    } catch {
      // notes is plain text
    }
    set({
      lineItems: items,
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      currency: invoice.currency,
      taxRate: invoice.tax_rate,
      senderInfo,
      recipientInfo,
      termsInfo,
      senderProfileId: invoice.sender_profile_id || null,
      recipientProfileId: invoice.recipient_profile_id || null,
    });
  },

  deleteInvoice: async (id) => {
    await commands.deleteInvoice(id);
    await get().fetchInvoices();
  },

  subtotal: () => get().lineItems.reduce((sum, item) => sum + item.amount, 0),
  taxAmount: () => get().subtotal() * (get().taxRate / 100),
  total: () => get().subtotal() + get().taxAmount(),

  reset: () => set({
    ...initialFormState,
    invoiceNumber: defaultNumber(),
    invoiceDate: today(),
    dueDate: today(),
    lineItems: [{ description: "", quantity: 0, rate: 0, amount: 0 }],
    senderProfileId: null,
    recipientProfileId: null,
  }),
}));
