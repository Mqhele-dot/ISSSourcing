import {z} from "zod";

export const documentEntity=z.enum(["purchase_order","requisition","invoice","supplier","warehouse","contract"]);
const sourceId=z.coerce.number().int().positive().max(2147483647);
const common={q:z.string().trim().max(120).optional(),entityType:documentEntity.optional(),entityId:sourceId.optional(),documentId:sourceId.optional(),
  archived:z.enum(["exclude","include","only"]).default("exclude"),fileStatus:z.enum(["all","available","missing","unverified"]).default("all"),
  sort:z.enum(["newest","oldest","name_asc","name_desc"]).default("newest")};
export const documentPageQuery=z.object({...common,page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)}).strict();
export const documentLegacyQuery=z.object({...common,limit:z.coerce.number().int().min(1).max(200).default(25),offset:z.coerce.number().int().min(0).max(10000000).default(0)}).strict();

/** A navigation reference, never an ownership or download authorization. */
export function documentLibraryHref(entityType:z.infer<typeof documentEntity>,entityId:number,documentId?:number){
  const source=documentPageQuery.parse({entityType,entityId,documentId,archived:"include"});
  const query=new URLSearchParams({entityType:source.entityType!,entityId:String(source.entityId),archived:"include"});
  if(source.documentId!==undefined)query.set("documentId",String(source.documentId));
  return `/admin/documents?${query}`;
}

/** Preserve duplicate values so the strict contract rejects ambiguous URLs. */
export function parseDocumentView(search:string){
  const raw:Record<string,unknown>=Object.create(null);
  for(const [key,value]of new URLSearchParams(search))raw[key]=key in raw?[raw[key],value]:value;
  return documentPageQuery.safeParse(raw);
}
