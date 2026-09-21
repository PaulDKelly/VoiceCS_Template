import { AudioLines } from "lucide-react";

type Props = {
  compact?: boolean;
  inverse?: boolean;
  subtitle?: string;
};

export default function TellioBrand({ compact = false, inverse = false, subtitle }: Props) {
  return (
    <div className="flex items-center gap-3" aria-label="Tellio">
      <span className={`grid shrink-0 place-items-center bg-[#ef5b4c] text-white ${compact ? "h-8 w-8" : "h-10 w-10"}`}>
        <AudioLines size={compact ? 18 : 22} strokeWidth={2.25} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className={`block font-semibold leading-none tracking-normal ${compact ? "text-lg" : "text-2xl"} ${inverse ? "text-white" : "text-[#17211d]"}`}>
          Tellio
        </span>
        {subtitle && (
          <span className={`mt-1 block text-[10px] uppercase tracking-[0.16em] ${inverse ? "text-gray-400" : "text-[#52635c]"}`}>
            {subtitle}
          </span>
        )}
      </span>
    </div>
  );
}
