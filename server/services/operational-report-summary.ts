import {format} from "date-fns";

/** Generic rows have no shared financial measure or verified FX observation. */
export function buildGenericSummaryMetrics(data:readonly unknown[],columns:readonly unknown[]):Array<{label:string;value:string}>{
  return [
    {label:"Records",value:String(data.length)},
    {label:"Columns",value:String(columns.length)},
    {label:"Updated",value:format(new Date(),"yyyy-MM-dd")},
  ];
}
