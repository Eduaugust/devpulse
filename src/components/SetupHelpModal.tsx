import { X } from "lucide-react";
import { setupGuides, renderStep } from "@/lib/setupGuides";

interface SetupHelpModalProps {
  connectionKey: string;
  onClose: () => void;
}

export function SetupHelpModal({ connectionKey, onClose }: SetupHelpModalProps) {
  const guide = setupGuides[connectionKey];
  if (!guide) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm">{guide.title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <ol className="space-y-3">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-xs">
                <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="text-muted-foreground pt-0.5">{renderStep(step)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
