import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";
import { Can } from "@/components/auth/can";

interface SecurityPolicy {
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  passwordMaxAgeDays?: number;
  passwordExpiryWarningDays: number;
  lockoutMaxAttempts: number;
  lockoutDurationMinutes: number;
  twoFactorRequired: boolean;
  twoFactorGracePeriodDays: number;
  ipWhitelistEnabled: boolean;
  ipWhitelist: string[];
  sessionTimeoutMinutes: number;
  requireEmailVerification: boolean;
  passwordHistoryCount: number;
}

/**
 * Security Policy Administration Panel
 * Manage password policies, 2FA, lockout settings, and compliance controls
 */
export function SecurityPolicyPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPolicyDialog, setShowPolicyDialog] = useState(false);
  const [ipWhitelistInput, setIpWhitelistInput] = useState("");
  const [editedPolicy, setEditedPolicy] = useState<Partial<SecurityPolicy>>({});

  // Fetch current security policy
  const { data: policy } = useQuery({
    queryKey: ["/api/admin/security-policy"],
    queryFn: () =>
      requestJson<SecurityPolicy>("GET", "/api/admin/security-policy").catch(
        () => ({
          passwordMinLength: 8,
          passwordRequireUppercase: true,
          passwordRequireLowercase: true,
          passwordRequireNumbers: true,
          passwordRequireSymbols: true,
          passwordMaxAgeDays: 90,
          passwordExpiryWarningDays: 14,
          lockoutMaxAttempts: 5,
          lockoutDurationMinutes: 30,
          twoFactorRequired: false,
          twoFactorGracePeriodDays: 7,
          ipWhitelistEnabled: false,
          ipWhitelist: [],
          sessionTimeoutMinutes: 60,
          requireEmailVerification: true,
          passwordHistoryCount: 5,
        })
      ),
    staleTime: 60_000,
  });

  // Update security policy mutation
  const updatePolicyMutation = useMutation({
    mutationFn: (updates: Partial<SecurityPolicy>) =>
      requestJson("PATCH", "/api/admin/security-policy", updates),
    onSuccess: () => {
      toast({ title: "Security policy updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security-policy"] });
      setShowPolicyDialog(false);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update policy",
        description: err?.message,
      });
    },
  });

  const handleSavePolicy = () => {
    updatePolicyMutation.mutate(editedPolicy);
  };

  const handleAddIpToWhitelist = () => {
    if (!ipWhitelistInput.trim()) return;

    const newIps = [
      ...(editedPolicy.ipWhitelist || policy?.ipWhitelist || []),
      ipWhitelistInput.trim(),
    ];

    setEditedPolicy({ ...editedPolicy, ipWhitelist: newIps });
    setIpWhitelistInput("");
  };

  const handleRemoveIpFromWhitelist = (ip: string) => {
    const newIps = (editedPolicy.ipWhitelist || policy?.ipWhitelist || []).filter(
      (i) => i !== ip
    );
    setEditedPolicy({ ...editedPolicy, ipWhitelist: newIps });
  };

  if (!policy) {
    return <div className="text-center py-8 text-gray-500">Loading security policy...</div>;
  }

  const currentPolicy = { ...policy, ...editedPolicy };

  return (
    <Can roles={["admin"]}>
      <div className="space-y-6">
        {/* Policy Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <Lock className="h-8 w-8 text-blue-600 mx-auto" />
                <h4 className="font-semibold text-sm">Password Policy</h4>
                <p className="text-2xl font-bold text-blue-600">
                  {currentPolicy.passwordMinLength} chars
                </p>
                <p className="text-xs text-gray-600">
                  {currentPolicy.passwordRequireUppercase ? "✓" : "✗"} Upper
                  {currentPolicy.passwordRequireNumbers ? "✓" : "✗"} Numbers
                  {currentPolicy.passwordRequireSymbols ? "✓" : "✗"} Symbols
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <AlertTriangle className="h-8 w-8 text-orange-600 mx-auto" />
                <h4 className="font-semibold text-sm">Account Lockout</h4>
                <p className="text-2xl font-bold text-orange-600">
                  {currentPolicy.lockoutMaxAttempts} attempts
                </p>
                <p className="text-xs text-gray-600">
                  Lock for {currentPolicy.lockoutDurationMinutes} minutes
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <Shield className="h-8 w-8 text-green-600 mx-auto" />
                <h4 className="font-semibold text-sm">2FA Status</h4>
                <p className="text-2xl font-bold text-green-600">
                  {currentPolicy.twoFactorRequired ? "Required" : "Optional"}
                </p>
                <p className="text-xs text-gray-600">
                  Grace period: {currentPolicy.twoFactorGracePeriodDays} days
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Security Recommendations */}
        <Alert className="border-yellow-300 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            <strong>Recommended Security Settings:</strong>
            <ul className="mt-2 text-sm space-y-1 ml-4 list-disc">
              {!currentPolicy.passwordRequireSymbols && (
                <li>Enable symbol requirement in passwords</li>
              )}
              {!currentPolicy.twoFactorRequired && (
                <li>Consider requiring 2FA for all users</li>
              )}
              {!currentPolicy.ipWhitelistEnabled && (
                <li>Enable IP whitelist for admin accounts</li>
              )}
              {(currentPolicy.passwordMaxAgeDays ?? 0) > 365 && (
                <li>Reduce password expiry period (currently {currentPolicy.passwordMaxAgeDays} days)</li>
              )}
            </ul>
          </AlertDescription>
        </Alert>

        {/* Policy Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>Security Policy Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="password" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="lockout">Lockout</TabsTrigger>
                <TabsTrigger value="mfa">2FA</TabsTrigger>
                <TabsTrigger value="session">Session</TabsTrigger>
              </TabsList>

              {/* Password Policy Tab */}
              <TabsContent value="password" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="password-length">Minimum Password Length</Label>
                    <Input
                      id="password-length"
                      type="number"
                      min="6"
                      max="128"
                      value={currentPolicy.passwordMinLength}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          passwordMinLength: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Required Character Types</Label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <Label className="text-sm cursor-pointer">Uppercase Letters (A-Z)</Label>
                        <Switch
                          checked={currentPolicy.passwordRequireUppercase}
                          onCheckedChange={(checked) =>
                            setEditedPolicy({
                              ...editedPolicy,
                              passwordRequireUppercase: checked,
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <Label className="text-sm cursor-pointer">Lowercase Letters (a-z)</Label>
                        <Switch
                          checked={currentPolicy.passwordRequireLowercase}
                          onCheckedChange={(checked) =>
                            setEditedPolicy({
                              ...editedPolicy,
                              passwordRequireLowercase: checked,
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <Label className="text-sm cursor-pointer">Numbers (0-9)</Label>
                        <Switch
                          checked={currentPolicy.passwordRequireNumbers}
                          onCheckedChange={(checked) =>
                            setEditedPolicy({
                              ...editedPolicy,
                              passwordRequireNumbers: checked,
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <Label className="text-sm cursor-pointer">Special Symbols (!@#$%)</Label>
                        <Switch
                          checked={currentPolicy.passwordRequireSymbols}
                          onCheckedChange={(checked) =>
                            setEditedPolicy({
                              ...editedPolicy,
                              passwordRequireSymbols: checked,
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="password-max-age">Maximum Password Age (days)</Label>
                    <Input
                      id="password-max-age"
                      type="number"
                      min="0"
                      max="365"
                      value={currentPolicy.passwordMaxAgeDays || ""}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          passwordMaxAgeDays: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                      placeholder="0 = No expiry"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Leave blank to disable password expiry
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="password-warning">Expiry Warning (days before)</Label>
                    <Input
                      id="password-warning"
                      type="number"
                      min="1"
                      max="30"
                      value={currentPolicy.passwordExpiryWarningDays}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          passwordExpiryWarningDays: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div>
                    <Label htmlFor="password-history">Password History</Label>
                    <Input
                      id="password-history"
                      type="number"
                      min="0"
                      max="24"
                      value={currentPolicy.passwordHistoryCount}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          passwordHistoryCount: Number(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Prevent reuse of last N passwords (0 = disabled)
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* Lockout Policy Tab */}
              <TabsContent value="lockout" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="lockout-attempts">Maximum Failed Attempts</Label>
                    <Input
                      id="lockout-attempts"
                      type="number"
                      min="1"
                      max="20"
                      value={currentPolicy.lockoutMaxAttempts}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          lockoutMaxAttempts: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div>
                    <Label htmlFor="lockout-duration">Lockout Duration (minutes)</Label>
                    <Input
                      id="lockout-duration"
                      type="number"
                      min="5"
                      max="1440"
                      value={currentPolicy.lockoutDurationMinutes}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          lockoutDurationMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <Alert className="border-blue-300 bg-blue-50">
                    <AlertDescription className="text-sm text-blue-800">
                      After <strong>{currentPolicy.lockoutMaxAttempts}</strong> failed login
                      attempts, accounts will be locked for{" "}
                      <strong>{currentPolicy.lockoutDurationMinutes} minutes</strong>.
                    </AlertDescription>
                  </Alert>
                </div>
              </TabsContent>

              {/* 2FA Tab */}
              <TabsContent value="mfa" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <Label className="text-sm cursor-pointer">Require 2FA for All Users</Label>
                    <Switch
                      checked={currentPolicy.twoFactorRequired}
                      onCheckedChange={(checked) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          twoFactorRequired: checked,
                        })
                      }
                    />
                  </div>

                  <div>
                    <Label htmlFor="2fa-grace">2FA Setup Grace Period (days)</Label>
                    <Input
                      id="2fa-grace"
                      type="number"
                      min="0"
                      max="30"
                      value={currentPolicy.twoFactorGracePeriodDays}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          twoFactorGracePeriodDays: Number(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Days to set up 2FA before enforcement (0 = immediate)
                    </p>
                  </div>

                  <Alert className="border-green-300 bg-green-50">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-sm text-green-800">
                      2FA uses Time-based One-Time Password (TOTP) via authenticator apps.
                      Users can set up multiple devices.
                    </AlertDescription>
                  </Alert>
                </div>
              </TabsContent>

              {/* Session Tab */}
              <TabsContent value="session" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="session-timeout">Session Timeout (minutes)</Label>
                    <Input
                      id="session-timeout"
                      type="number"
                      min="5"
                      max="1440"
                      value={currentPolicy.sessionTimeoutMinutes}
                      onChange={(e) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          sessionTimeoutMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <Label className="text-sm cursor-pointer">Require Email Verification</Label>
                    <Switch
                      checked={currentPolicy.requireEmailVerification}
                      onCheckedChange={(checked) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          requireEmailVerification: checked,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <Label className="text-sm cursor-pointer">Enable IP Whitelist</Label>
                    <Switch
                      checked={currentPolicy.ipWhitelistEnabled}
                      onCheckedChange={(checked) =>
                        setEditedPolicy({
                          ...editedPolicy,
                          ipWhitelistEnabled: checked,
                        })
                      }
                    />
                  </div>

                  {currentPolicy.ipWhitelistEnabled && (
                    <div className="space-y-3 p-3 border rounded-lg bg-blue-50">
                      <Label>IP Whitelist</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter IP address (e.g., 192.168.1.1)"
                          value={ipWhitelistInput}
                          onChange={(e) => setIpWhitelistInput(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") handleAddIpToWhitelist();
                          }}
                        />
                        <Button size="sm" onClick={handleAddIpToWhitelist}>
                          Add
                        </Button>
                      </div>

                      {currentPolicy.ipWhitelist.length > 0 && (
                        <div className="space-y-2">
                          {currentPolicy.ipWhitelist.map((ip) => (
                            <div
                              key={ip}
                              className="flex items-center justify-between bg-white p-2 rounded border"
                            >
                              <code className="text-sm">{ip}</code>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemoveIpFromWhitelist(ip)}
                              >
                                Remove
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditedPolicy({});
                  setShowPolicyDialog(false);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSavePolicy}
                disabled={updatePolicyMutation.isPending}
              >
                {updatePolicyMutation.isPending ? "Saving..." : "Save Policy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Can>
  );
}
