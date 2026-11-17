import assert from "node:assert/strict";
import {documentLibraryHref,documentPageQuery,documentLegacyQuery,parseDocumentView} from "../shared/document-query";

const href=documentLibraryHref("supplier",42,900);
assert.equal(href,"/admin/documents?entityType=supplier&entityId=42&archived=include&documentId=900");
const parsed=parseDocumentView(href.split("?")[1]);assert.ok(parsed.success);
assert.equal(parsed.data.documentId,900);assert.equal(parsed.data.pageSize,25);assert.equal(parsed.data.archived,"include");
assert.equal(documentLegacyQuery.parse({documentId:"900"}).documentId,900);
for(const search of ["documentId=0","documentId=abc","documentId=1&documentId=2","entityId=-3","pageSize=5000","unknown=1","archived=bad","__proto__=ignored","constructor=ignored"])
  assert.equal(parseDocumentView(search).success,false,search);
assert.equal(documentPageQuery.parse({fileStatus:"available",page:5,q:" File name "}).q,"File name");
assert.throws(()=>documentLibraryHref("supplier",-1,900));
console.log("Document query contract passed: exact source links, strict IDs/duplicates/filters, bounded pages and legacy compatibility. Links grant no access.");
