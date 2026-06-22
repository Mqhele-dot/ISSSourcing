import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Can } from "@/components/auth/can";
import { PageDataState } from "@/components/page-shell";
import { Edit, Phone, Mail, MapPin, Trash2, Plus, User, ExternalLink } from "lucide-react";
import type { Supplier } from "@shared/schema";
import type { SupplierPerformanceRow } from "@/pages/suppliers/use-suppliers-core-queries";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export type SuppliersListCardProps = {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  suppliers: Supplier[] | undefined;
  refetch: () => void;
  selectedSupplierId: number | null;
  selectedLogo: { logoUrl: string } | null | undefined;
  paymentTermsById: Map<number, string>;
  carriersById: Map<number, string>;
  performanceBySupplier: Map<number, SupplierPerformanceRow>;
  /** When false, empty list prompts to finish product setup instead of add-supplier CTA. */
  productSetupComplete?: boolean;
  onAddSupplier: () => void;
  onEditSupplier: (supplier: Supplier) => void;
  onDeleteSupplier: (supplier: Supplier) => void;
  onOpenLogoDialog: (supplier: Supplier) => void;
};

export function SuppliersListCard({
  isLoading,
  isError,
  error,
  suppliers,
  refetch,
  selectedSupplierId,
  selectedLogo,
  paymentTermsById,
  carriersById,
  performanceBySupplier,
  productSetupComplete = true,
  onAddSupplier,
  onEditSupplier,
  onDeleteSupplier,
  onOpenLogoDialog,
}: SuppliersListCardProps) {
  return (
    <Card data-tour="suppliers-list">
      <CardHeader>
        <CardTitle>Supplier List</CardTitle>
        <CardDescription>View and manage your suppliers</CardDescription>
      </CardHeader>
      <CardContent>
        <PageDataState
          isLoading={isLoading}
          error={isError ? error : null}
          isEmpty={!isLoading && !isError && (!suppliers || suppliers.length === 0)}
          warnEmptyWhenDegraded
          errorTitle="Could not load suppliers"
          onRetry={() => refetch()}
          loadingView={
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-4 p-4 border rounded-md">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              ))}
            </div>
          }
          emptyView={
            <div className="text-center py-8">
              <p className="text-muted-foreground">No suppliers found</p>
              {productSetupComplete ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">Get started by adding a supplier</p>
                  <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add suppliers">
                    <Button type="button" className="mt-4" onClick={onAddSupplier}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add supplier
                    </Button>
                  </Can>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Finish{" "}
                  <Link href={APP_ROUTES.setup.product} className="font-medium text-primary underline">
                    product setup
                  </Link>{" "}
                  first, then add your first supplier.
                </p>
              )}
            </div>
          }
        >
          <ScrollArea className="h-[500px]">
            <div className="space-y-4">
              {(suppliers ?? []).map((supplier: Supplier) => (
                <div
                  key={supplier.id}
                  className="flex flex-col p-4 border rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  <div className="flex justify-between">
                    <div className="flex items-center">
                      <div className="mr-4 h-12 w-12 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center overflow-hidden">
                        {supplier.id === selectedSupplierId && selectedLogo ? (
                          <img src={selectedLogo.logoUrl} alt={`${supplier.name} logo`} className="h-full w-full object-cover" />
                        ) : (
                          <User className="h-6 w-6 text-neutral-400" />
                        )}
                      </div>
                      <div>
                        <Link href={APP_ROUTES.procurement.supplier(supplier.id)}>
                          <h3 className="font-medium hover:underline inline-flex items-center gap-1">
                            {supplier.name}
                            <ExternalLink className="h-3 w-3 opacity-50" aria-hidden />
                          </h3>
                        </Link>
                        {supplier.contactName && <p className="text-sm text-muted-foreground">{supplier.contactName}</p>}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit suppliers">
                        <Button variant="outline" size="sm" onClick={() => onOpenLogoDialog(supplier)}>
                          Logo
                        </Button>
                      </Can>
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit suppliers">
                        <Button variant="outline" size="icon" onClick={() => onEditSupplier(supplier)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </Can>
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to delete suppliers">
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => onDeleteSupplier(supplier)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Can>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    {supplier.email && (
                      <div className="flex items-center">
                        <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                        <a href={`mailto:${supplier.email}`} className="text-blue-500 hover:underline">
                          {supplier.email}
                        </a>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="flex items-center">
                        <Phone className="h-4 w-4 mr-2 text-muted-foreground" />
                        <a href={`tel:${supplier.phone}`} className="text-blue-500 hover:underline">
                          {supplier.phone}
                        </a>
                      </div>
                    )}
                    {supplier.address && (
                      <div className="flex items-center col-span-2">
                        <MapPin className="h-4 w-4 mr-2 text-muted-foreground flex-shrink-0" />
                        <span>{supplier.address}</span>
                      </div>
                    )}
                    {(supplier as { taxIdentificationNumber?: string }).taxIdentificationNumber && (
                      <div className="flex items-center col-span-2">
                        <span className="text-muted-foreground text-sm">Tax ID:</span>
                        <span className="ml-2">{(supplier as { taxIdentificationNumber: string }).taxIdentificationNumber}</span>
                      </div>
                    )}
                    {(supplier as { bankName?: string | null }).bankName && (
                      <div className="flex items-center col-span-2">
                        <span className="text-muted-foreground text-sm">Bank:</span>
                        <span className="ml-2">{(supplier as { bankName: string }).bankName}</span>
                      </div>
                    )}
                    {(supplier as { defaultCurrencyCode?: string | null }).defaultCurrencyCode && (
                      <div className="flex items-center col-span-2">
                        <span className="text-muted-foreground text-sm">Default currency:</span>
                        <span className="ml-2">{(supplier as { defaultCurrencyCode: string }).defaultCurrencyCode}</span>
                      </div>
                    )}
                    {(supplier as { paymentTermsId?: number | null }).paymentTermsId ? (
                      <div className="flex items-center col-span-2">
                        <span className="text-muted-foreground text-sm">Payment terms:</span>
                        <span className="ml-2">
                          {paymentTermsById.get((supplier as { paymentTermsId: number }).paymentTermsId) ??
                            `Term #${(supplier as { paymentTermsId: number }).paymentTermsId}`}
                        </span>
                      </div>
                    ) : null}
                    {(supplier as { defaultCarrierId?: number | null }).defaultCarrierId ? (
                      <div className="flex items-center col-span-2">
                        <span className="text-muted-foreground text-sm">Preferred carrier:</span>
                        <span className="ml-2">
                          {carriersById.get((supplier as { defaultCarrierId: number }).defaultCarrierId) ??
                            `Carrier #${(supplier as { defaultCarrierId: number }).defaultCarrierId}`}
                        </span>
                      </div>
                    ) : null}
                    {performanceBySupplier.get(supplier.id) ? (
                      <div className="flex items-center col-span-2">
                        <span className="text-muted-foreground text-sm">Supplier rating:</span>
                        <span className="ml-2">
                          {performanceBySupplier.get(supplier.id)?.overallRating.toFixed(1)}/5
                          {" · "}
                          OTD {performanceBySupplier.get(supplier.id)?.onTimeDeliveryRate.toFixed(1)}%
                          {" · "}
                          Price compliance {performanceBySupplier.get(supplier.id)?.priceComplianceRate.toFixed(1)}%
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {supplier.notes && (
                    <div className="mt-3 pt-3 border-t text-sm">
                      <p className="text-muted-foreground">{supplier.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </PageDataState>
      </CardContent>
    </Card>
  );
}
