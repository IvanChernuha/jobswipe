"""Extract raw text from uploaded CV files (PDF, DOCX, plain text)."""
import io


def extract_text(content: bytes, content_type: str) -> str:
    if content_type == "application/pdf":
        return _extract_pdf(content)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(content)
    # Fallback: treat as plain text
    return content.decode("utf-8", errors="ignore")


def _extract_pdf(content: bytes) -> str:
    import pdfplumber

    text_parts = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


def _extract_docx(content: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(content))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
