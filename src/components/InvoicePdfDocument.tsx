import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { InvoiceLineItem } from "@/lib/types";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#333" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 30 },
  invoiceTitle: { fontSize: 28, fontWeight: "bold", color: "#333" },
  invoiceNumber: { fontSize: 12, color: "#555", textAlign: "right", marginTop: 8 },
  section: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  halfColumn: { width: "48%" },
  label: { fontSize: 8, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 },
  value: { fontSize: 9, marginBottom: 2, lineHeight: 1.4 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 15 },
  metaBlock: { width: "30%" },
  tableHeader: { flexDirection: "row", backgroundColor: "#333", color: "#fff", padding: 6, marginTop: 10 },
  tableHeaderText: { fontSize: 8, fontWeight: "bold", color: "#fff", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", padding: 6, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  tableRowAlt: { flexDirection: "row", padding: 6, borderBottomWidth: 0.5, borderBottomColor: "#ddd", backgroundColor: "#f9f9f9" },
  colItem: { width: "45%" },
  colQty: { width: "15%", textAlign: "right" },
  colRate: { width: "20%", textAlign: "right" },
  colAmount: { width: "20%", textAlign: "right" },
  totalsContainer: { marginTop: 10, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 200, justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { fontSize: 9, color: "#555" },
  totalValue: { fontSize: 9, textAlign: "right" },
  totalFinalRow: { flexDirection: "row", width: 200, justifyContent: "space-between", paddingVertical: 5, borderTopWidth: 1, borderTopColor: "#333", marginTop: 2 },
  totalFinalLabel: { fontSize: 11, fontWeight: "bold" },
  totalFinalValue: { fontSize: 11, fontWeight: "bold", textAlign: "right" },
  termsSection: { marginTop: 30, paddingTop: 15, borderTopWidth: 0.5, borderTopColor: "#ddd" },
  termsTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 8 },
});

export function formatCurrency(value: number, currency: string): string {
  const symbol = currency === "USD" ? "US$" : currency === "EUR" ? "€" : currency === "BRL" ? "R$" : currency;
  const parts = value.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${symbol} ${intPart},${parts[1]}`;
}

export interface InvoicePdfProps {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  senderInfo: string;
  recipientInfo: string;
  termsInfo: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function TextBlock({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Text key={i} style={i === 0 ? { fontSize: 9, fontWeight: "bold", marginBottom: 2 } : { fontSize: 9, marginBottom: 1, lineHeight: 1.4 }}>
          {line}
        </Text>
      ))}
    </>
  );
}

export function InvoicePdfDocument(props: InvoicePdfProps) {
  const {
    invoiceNumber, invoiceDate, dueDate, currency,
    senderInfo, recipientInfo, termsInfo,
    lineItems, subtotal, taxRate, taxAmount, total,
  } = props;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.invoiceTitle}>INVOICE</Text>
          <Text style={styles.invoiceNumber}># {invoiceNumber}</Text>
        </View>

        {/* From / Bill To */}
        <View style={styles.section}>
          <View style={styles.halfColumn}>
            <Text style={styles.label}>From</Text>
            {senderInfo ? <TextBlock text={senderInfo} /> : null}
          </View>
          <View style={styles.halfColumn}>
            <Text style={styles.label}>Bill To</Text>
            {recipientInfo ? <TextBlock text={recipientInfo} /> : null}
          </View>
        </View>

        {/* Date / Due Date */}
        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>{formatDate(invoiceDate)}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Due Date</Text>
            <Text style={styles.value}>{formatDate(dueDate)}</Text>
          </View>
          <View style={styles.metaBlock} />
        </View>

        {/* Table */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.colItem]}>Item</Text>
          <Text style={[styles.tableHeaderText, styles.colQty]}>Quantity</Text>
          <Text style={[styles.tableHeaderText, styles.colRate]}>Rate</Text>
          <Text style={[styles.tableHeaderText, styles.colAmount]}>Amount</Text>
        </View>
        {lineItems.map((item, i) => (
          <View key={i} style={i % 2 === 1 ? styles.tableRowAlt : styles.tableRow}>
            <Text style={styles.colItem}>{item.description}</Text>
            <Text style={styles.colQty}>{item.quantity.toFixed(2)}</Text>
            <Text style={styles.colRate}>{formatCurrency(item.rate, currency)}</Text>
            <Text style={styles.colAmount}>{formatCurrency(item.amount, currency)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsContainer}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatCurrency(subtotal, currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax ({taxRate}%)</Text>
            <Text style={styles.totalValue}>{formatCurrency(taxAmount, currency)}</Text>
          </View>
          <View style={styles.totalFinalRow}>
            <Text style={styles.totalFinalLabel}>Total</Text>
            <Text style={styles.totalFinalValue}>{formatCurrency(total, currency)}</Text>
          </View>
        </View>

        {/* Terms */}
        {termsInfo && (
          <View style={styles.termsSection}>
            <Text style={styles.termsTitle}>Terms</Text>
            {termsInfo.split("\n").map((line, i) => (
              <Text key={i} style={styles.value}>{line}</Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
