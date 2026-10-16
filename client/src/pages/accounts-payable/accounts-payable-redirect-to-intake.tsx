import { Redirect } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export default function AccountsPayableRedirectToIntake() {
  return <Redirect to={APP_ROUTES.finance.accountsPayableIntake} />;
}
