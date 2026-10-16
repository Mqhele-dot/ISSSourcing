import { Redirect } from "wouter";

/** File URLs and older links may use `/uploads/...`; the app serves documents from `/documents`. */
export default function UploadsPathRedirect() {
  return <Redirect to="/documents" />;
}
