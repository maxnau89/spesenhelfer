"""
Assemble final PDF export: CC statement + receipts sorted by transaction date.
"""

from pathlib import Path


def assemble_pdf(statement_path: str, receipt_paths: list[str], output_path: str) -> None:
    """
    Merge statement PDF + receipt PDFs (in order) into a single output PDF.
    """
    from pypdf import PdfWriter

    writer = PdfWriter()

    def _add(path: str) -> None:
        p = Path(path)
        if p.exists():
            writer.append(str(p))

    _add(statement_path)
    for rp in receipt_paths:
        _add(rp)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        writer.write(f)
