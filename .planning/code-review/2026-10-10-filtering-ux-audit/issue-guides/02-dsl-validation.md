**TL;DR:** Malformed input and unsupported rules currently look valid. Validate the whole expression, field, operator and raw value before coercion.

**Priority:** P1 · Bug.

**Evidence:** `dsl/parser.ts` accepts a valid prefix without consuming every token; `tokenizer.ts` accepts an unclosed quote. Inputs such as `gene:=:BRCA1 AND`, `gene:=:BRCA1)` and `gene:=:BRCA1 cadd:>=:20` can apply only the first rule. `cadd:=:""` becomes zero. Unsupported `!~`, `^` and `$` translate to ordinary contains.

**Implementation guide:**

- Require complete token consumption, operands after combinators, balanced groups and closed strings.
- Use the existing field registry to enforce operators and scope. Register extension fields from shared metadata rather than accidentally rejecting them.
- Validate raw numeric text before Number conversion; distinguish explicit zero, empty text and missing values.
- Reject empty/whitespace contains conditions that the backend would skip. Keep exact empty-string comparison a separate, explicit contract.

**Acceptance:** Cover malformed examples, unknown fields, `cadd:<:abc`, blank numeric values, empty contains, valid zero, null checks, escaped quotes and `cnv.copy_number:<:2`. Invalid input emits no query and leaves applied state intact.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

