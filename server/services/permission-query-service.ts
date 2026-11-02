import type {Pool} from 'pg';
import {userRoleEnum,resourceEnum,permissionTypeEnum} from '../../shared/schema';

type Query=Pick<Pool,'query'>;
const validId=(id:number)=>Number.isSafeInteger(id)&&id>0&&id<=2147483647;
const known=(values:readonly string[],value:string)=>values.includes(value);
const knownPermission=(resource:string,action:string)=>known(resourceEnum.enumValues,resource)&&known(permissionTypeEnum.enumValues,action);

/** Canonical permission predicates shared by request storage and transaction-
 * aware workers. No caching, tenant inference or independent pool is used.
 * lock=true requires the caller's explicit read/write transaction; returned
 * grant/role rows remain SHARE-locked until that transaction completes.
 */
export async function queryRolePermission(database:Query,role:string,resource:string,action:string,lock=false){
  if(String(role).toLowerCase()==='admin')return true;
  if(!known(userRoleEnum.enumValues,role)||!knownPermission(resource,action))return false;
  const result=await database.query(`SELECT p.id FROM permissions p WHERE p.role=$1 AND p.resource=$2 AND p.permission_type=$3 LIMIT 1${lock?' FOR SHARE OF p':''}`,[role,resource,action]);
  return result.rowCount===1;
}
export async function queryUserCustomRoleId(database:Query,organizationId:number,userId:number,lock=false):Promise<number|null>{
  if(!validId(organizationId)||!validId(userId))return null;
  const user=await database.query(`SELECT u.preferences FROM users u WHERE u.id=$1${lock?' FOR SHARE OF u':''}`,[userId]);
  const preferences=user.rows[0]?.preferences;
  const id=Number(preferences&&typeof preferences==='object'?preferences.customRoleId:undefined);
  if(!validId(id))return null;
  const role=await database.query(`SELECT r.id FROM custom_roles r WHERE r.id=$1 AND r.organization_id=$2 AND r.is_active=true LIMIT 1${lock?' FOR SHARE OF r':''}`,[id,organizationId]);
  return role.rows[0]?.id??null;
}
export async function queryCustomRolePermission(database:Query,organizationId:number,roleId:number,resource:string,action:string,lock=false){
  if(!validId(organizationId)||!validId(roleId)||!knownPermission(resource,action))return false;
  const result=await database.query(`SELECT p.id FROM custom_role_permissions p JOIN custom_roles r ON r.id=p.role_id AND r.organization_id=$1 AND r.is_active=true WHERE p.role_id=$2 AND p.resource=$3 AND p.permission_type=$4 LIMIT 1${lock?' FOR SHARE OF p,r':''}`,[organizationId,roleId,resource,action]);
  return result.rowCount===1;
}
