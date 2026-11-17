# ESLint Warnings - Detailed Fixes

## Summary
- **Total warnings:** 7
- **Category:** React Hook dependencies (5), Type imports (1)
- **Severity:** Non-blocking (no broken code)
- **Fix effort:** ~30 minutes for all

---

## Warning Details & Fixes

### 1. `use-async-resource.ts:135` - Spread Element in Dependency Array

**Current Code:**
```typescript
useEffect(() => {
  // ...
}, [dep1, ...deps])  // Line 135
```

**Problem:**
React Hook linter cannot statically verify whether spread elements include all necessary dependencies.

**Fix Options:**

**Option A:** Expand array explicitly
```typescript
useEffect(() => {
  // ...
}, [dep1, dep2, dep3])  // Replace spread with explicit deps
```

**Option B:** Wrap in useMemo if deps is dynamic
```typescript
const memoizedDeps = useMemo(() => [dep1, ...deps], [dep1, ...deps]);
useEffect(() => {
  // ...
}, [memoizedDeps])
```

**Recommended:** Option A (explicit is better than implicit for hooks)

---

### 2-4. `inventory.tsx:167` - `warehouses` Conditional

**Current Code:**
```typescript
const warehouses = isLoading ? [] : (data?.warehouses || []);

const memoizedData = useMemo(() => {
  // ... uses warehouses
  return result;
}, [warehouses, otherDeps])  // Line 167
```

**Problem:**
`warehouses` is created inline in the render, so it changes on every render even if `isLoading`/`data` don't change. This makes the useMemo re-run unnecessarily.

**Fix:**
```typescript
const memoizedWarehouses = useMemo(
  () => isLoading ? [] : (data?.warehouses || []),
  [isLoading, data?.warehouses]
);

const memoizedData = useMemo(() => {
  // ... uses memoizedWarehouses
  return result;
}, [memoizedWarehouses, otherDeps])
```

---

### 5-6. `invoices.tsx:296-297` - `purchaseOrders` & `taxCodes` Conditional

**Current Code:**
```typescript
const purchaseOrders = isLoading ? [] : (data?.orders || []);
const taxCodes = isLoading ? [] : (data?.taxes || []);

const memoData1 = useMemo(() => {
  // ... uses purchaseOrders
  return result1;
}, [purchaseOrders])  // Line 313

const memoData2 = useMemo(() => {
  // ... uses purchaseOrders, taxCodes
  return result2;
}, [purchaseOrders, taxCodes])  // Line 317 & 324
```

**Fix:**
```typescript
const memoizedPurchaseOrders = useMemo(
  () => isLoading ? [] : (data?.orders || []),
  [isLoading, data?.orders]
);

const memoizedTaxCodes = useMemo(
  () => isLoading ? [] : (data?.taxes || []),
  [isLoading, data?.taxes]
);

const memoData1 = useMemo(() => {
  // ... uses memoizedPurchaseOrders
  return result1;
}, [memoizedPurchaseOrders])

const memoData2 = useMemo(() => {
  // ... uses memoizedPurchaseOrders, memoizedTaxCodes
  return result2;
}, [memoizedPurchaseOrders, memoizedTaxCodes])
```

---

### 7. `requisitions.tsx:127` - `requisitions` Conditional

**Current Code:**
```typescript
const requisitions = isLoading ? [] : (data?.reqs || []);

const memoData = useMemo(() => {
  // ... uses requisitions
  return result;
}, [requisitions])  // Line 193
```

**Fix:**
```typescript
const memoizedRequisitions = useMemo(
  () => isLoading ? [] : (data?.reqs || []),
  [isLoading, data?.reqs]
);

const memoData = useMemo(() => {
  // ... uses memoizedRequisitions
  return result;
}, [memoizedRequisitions])
```

---

### 8. `register-ap-routes.ts:2` - Type Import Convention

**Current Code:**
```typescript
import { z } from "zod";
// z is only used in type context, e.g.:
type MySchema = z.infer<typeof schema>;
```

**Fix (Option A):** Use type-only import
```typescript
import type { z } from "zod";
```

**Fix (Option B):** Use automatic fix
```bash
npx eslint server/modules/accounts-payable/register-ap-routes.ts --fix
```

**Why:** Type-only imports are erased at runtime, reducing bundle size.

---

## Batch Fix Command

To fix all fixable warnings at once:
```bash
npx eslint . --fix --ext .ts,.tsx
```

This will:
1. ✅ Fix the type import in `register-ap-routes.ts`
2. ⏭️ Report the 6 React Hook issues (require manual review)

---

## Testing After Fixes

After applying fixes:

```bash
# Verify lint passes
npm run lint

# Check that functionality still works
npm run dev
# Then manually test the affected pages:
# - Inventory page
# - Invoices page
# - Requisitions page
```

---

## Why These Matter

### React Hook Dependencies
- **Performance:** Unnecessary re-renders slow down the app, especially on large tables
- **Bugs:** Missing dependencies can cause stale closures and incorrect behavior
- **Stability:** Best practice prevents future issues as code evolves

### Type Imports
- **Bundle size:** Type-only imports don't appear in runtime code
- **Best practice:** Clarifies intent (this is only a type, not a value)
- **Compatibility:** Supports TypeScript strict mode better

---

## Prevention

To prevent future lint issues:

1. **Enable pre-commit hooks** (optional):
   ```bash
   npm install -D husky lint-staged
   npx husky install
   ```

2. **Run lint before committing**:
   ```bash
   npm run lint
   ```

3. **Use editor integration**: Install ESLint extension in VS Code for real-time warnings

4. **CI enforcement** (when ready):
   ```bash
   # Make lint required in CI (currently report-only)
   # Update .github/workflows/ci.yml to fail on warnings
   ```
