interface PaginationProps {
  currentPage: number;
  totalPages: number | null;
  hasPrev: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export default function Pagination({ currentPage, totalPages, hasPrev, hasNext, loading, onPrev, onNext }: PaginationProps) {
  const label = totalPages !== null ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`;
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-gray-100">
      <button
        onClick={onPrev}
        disabled={!hasPrev || loading}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Previous
      </button>
      <span className="text-sm text-gray-500 min-w-[90px] text-center">{label}</span>
      <button
        onClick={onNext}
        disabled={!hasNext || loading}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
}
