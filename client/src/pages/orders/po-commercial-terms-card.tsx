import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DepartmentOpt = { id: number; code: string; name: string };
type ContractOpt = { id: number; title: string; supplierId: number };
type TermOpt = { id: number; code: string; name: string };
type IncotermOpt = { id: number; code: string; name: string };

export type PoCommercialTermsCardProps = {
  departmentId: string;
  setDepartmentId: (v: string) => void;
  contractId: string;
  setContractId: (v: string) => void;
  paymentTermsId: string;
  setPaymentTermsId: (v: string) => void;
  incotermId: string;
  setIncotermId: (v: string) => void;
  departments: DepartmentOpt[];
  contractsForSupplier: ContractOpt[];
  paymentTerms: TermOpt[];
  incoterms: IncotermOpt[];
  saveCommercialTerms: { mutate: () => void; isPending: boolean };
};

export function PoCommercialTermsCard({
  departmentId,
  setDepartmentId,
  contractId,
  setContractId,
  paymentTermsId,
  setPaymentTermsId,
  incotermId,
  setIncotermId,
  departments,
  contractsForSupplier,
  paymentTerms,
  incoterms,
  saveCommercialTerms,
}: PoCommercialTermsCardProps) {
  return (
    <Card id="po-commercial" className="scroll-mt-36">
      <CardHeader>
        <CardTitle>Commercial terms</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="po-department">Department</Label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger id="po-department">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={String(department.id)}>
                  {department.code} - {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-contract">Contract reference</Label>
          <Select value={contractId} onValueChange={setContractId}>
            <SelectTrigger id="po-contract">
              <SelectValue placeholder="Select contract" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {contractsForSupplier.map((contract) => (
                <SelectItem key={contract.id} value={String(contract.id)}>
                  #{contract.id} - {contract.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-payment-terms">Payment terms</Label>
          <Select value={paymentTermsId} onValueChange={setPaymentTermsId}>
            <SelectTrigger id="po-payment-terms">
              <SelectValue placeholder="Select payment terms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {paymentTerms.map((term) => (
                <SelectItem key={term.id} value={String(term.id)}>
                  {term.code} - {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-incoterm">Incoterm</Label>
          <Select value={incotermId} onValueChange={setIncotermId}>
            <SelectTrigger id="po-incoterm">
              <SelectValue placeholder="Select incoterm" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {incoterms.map((incoterm) => (
                <SelectItem key={incoterm.id} value={String(incoterm.id)}>
                  {incoterm.code} - {incoterm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button type="button" onClick={() => saveCommercialTerms.mutate()} disabled={saveCommercialTerms.isPending}>
            Save terms
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
