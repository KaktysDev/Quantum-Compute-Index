import {NextResponse} from "next/server"; import {withQciSnapshot} from "@/lib/qrouter/catalog"; import {getLatestSnapshot} from "@/lib/qci/store";
export const dynamic="force-dynamic"; export async function GET(){const snapshot=await getLatestSnapshot();return NextResponse.json({object:"list",data:withQciSnapshot(snapshot.components),qci:{timestamp:snapshot.ts,price:snapshot.price,source:snapshot.source}});}

