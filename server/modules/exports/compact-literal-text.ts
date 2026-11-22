/** Use public, unformatted rich-text runs to keep an escape-looking source
 * sequence from becoming an OOXML escape within an individual text node.
 * Splits occur only AFTER its leading ASCII underscore, never inside a Unicode
 * surrogate pair. Scan every position to cover overlapping _x005F_x000D_.
 * Microsoft inline rich-text model: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.inlinestring
 * Native Excel compatibility remains a release gate, not an inference here.
 */
export function compactLiteralText(value:string):{richText:Array<{text:string}>}{
  if(!/_x[0-9a-fA-F]{4}_/.test(value))return {richText:[{text:value}]};
  const richText:Array<{text:string}>=[];let start=0;
  for(let index=0;index<value.length;index++)if(value[index]==='_'&&/^x[0-9a-fA-F]{4}_/.test(value.slice(index+1,index+7))){
    richText.push({text:value.slice(start,index+1)});start=index+1;
  }
  if(start<value.length||richText.length===0)richText.push({text:value.slice(start)});
  return {richText};
}
