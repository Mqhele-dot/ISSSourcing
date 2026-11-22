/** Match the same single URI decoding as serve-static/send. Windows accepts
 * backslashes, case aliases and trailing dots/spaces; none may bypass the API. */
export function isProtectedExportUploadPath(pathname:string):boolean{
  try{return decodeURIComponent(pathname).split(/[\\/]/).some(segment=>["exports","documents"].includes(segment.split(":",1)[0].replace(/[ .]+$/g,"").toLowerCase()));}
  catch{return true;}
}
