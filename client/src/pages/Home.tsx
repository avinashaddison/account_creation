import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ArrowRight, Medal, Ticket, AlertCircle } from "lucide-react";
import heroBg from "@/assets/images/hero-bg.png";

export default function Home() {
  const [step, setStep] = useState(0);

  const nextStep = () => setStep((s) => s + 1);
  const prevStep = () => setStep((s) => s - 1);

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left side - Branding / Decorative */}
      <div className="hidden lg:flex w-1/2 relative bg-black items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-secondary/80 mix-blend-multiply z-10" />
        <img 
          src={heroBg} 
          alt="Athletic background" 
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="relative z-20 text-white p-12 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-6xl font-black uppercase tracking-tighter mb-4 leading-none">
              LA28 <br/>
              <span className="text-secondary">OKC Locals</span><br/>
              Presale
            </h1>
            <p className="text-xl opacity-90 font-medium max-w-md">
              Join the movement. Secure your spot in history with exclusive early access to tickets for the LA28 Olympic & Paralympic Games.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Right side - Form flow */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 md:p-24 relative overflow-hidden">
        <div className="w-full max-w-md relative z-10">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div>
                  <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-6">
                    <Ticket className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight mb-2">Ready for LA28?</h2>
                  <p className="text-muted-foreground">
                    Register now for the exclusive OKC Locals presale. Create your profile, verify your identity, and get ready for the draw.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">1</div>
                    <div>
                      <h4 className="font-semibold">Create Account</h4>
                      <p className="text-sm text-muted-foreground">Basic details and preferences</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">2</div>
                    <div>
                      <h4 className="font-semibold">Verify Email</h4>
                      <p className="text-sm text-muted-foreground">Secure your account</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">3</div>
                    <div>
                      <h4 className="font-semibold">Complete Profile</h4>
                      <p className="text-sm text-muted-foreground">Select favorite sports</p>
                    </div>
                  </div>
                </div>

                <Button size="lg" className="w-full h-14 text-lg font-semibold" onClick={nextStep}>
                  Register Now
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight mb-1">Create Account</h2>
                  <p className="text-sm text-muted-foreground">Please fill in your details to continue.</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input id="email" type="email" placeholder="hello@example.com" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First name</Label>
                      <Input id="firstName" placeholder="John" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last name</Label>
                      <Input id="lastName" placeholder="Doe" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" />
                  </div>

                  <div className="space-y-2">
                    <Label>Place of residence</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="us">United States</SelectItem>
                        <SelectItem value="uk">United Kingdom</SelectItem>
                        <SelectItem value="ca">Canada</SelectItem>
                        <SelectItem value="au">Australia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select defaultValue="en">
                      <SelectTrigger>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="fr">Français</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-2 space-y-3">
                    <div className="flex items-start space-x-3">
                      <Checkbox id="age" className="mt-1" />
                      <Label htmlFor="age" className="text-sm font-normal leading-snug">
                        I confirm that I am 18 years of age or older.
                      </Label>
                    </div>
                    <div className="flex items-start space-x-3">
                      <Checkbox id="terms" className="mt-1" />
                      <Label htmlFor="terms" className="text-sm font-normal leading-snug">
                        I agree to the <a href="#" className="text-primary hover:underline">Terms of Use</a> and acknowledge the Privacy Policy.
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" className="h-12 w-full" onClick={prevStep}>Back</Button>
                  <Button className="h-12 w-full" onClick={nextStep}>
                    Submit & Continue
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight">Verify your email</h2>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    We've sent a 6-digit verification code to your email. Please enter it below.
                  </p>
                </div>

                <div className="flex justify-center gap-2 py-6">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <Input key={i} className="w-12 h-14 text-center text-lg font-bold" maxLength={1} placeholder="0" />
                  ))}
                </div>

                <div className="flex flex-col gap-3 pt-4">
                  <Button className="h-12 w-full" onClick={nextStep}>
                    Verify Code
                  </Button>
                  <Button variant="ghost" className="text-sm">
                    Resend code
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight mb-1">Complete Draw Profile</h2>
                  <p className="text-sm text-muted-foreground">Select your favorites to personalize your experience.</p>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Favorite Olympic Sport</Label>
                    <Select>
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Select sport" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="athletics">Athletics</SelectItem>
                        <SelectItem value="swimming">Swimming</SelectItem>
                        <SelectItem value="gymnastics">Gymnastics</SelectItem>
                        <SelectItem value="basketball">Basketball</SelectItem>
                        <SelectItem value="skateboarding">Skateboarding</SelectItem>
                        <SelectItem value="surfing">Surfing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Favorite Paralympic Sport</Label>
                    <Select>
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Select para sport" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="para-athletics">Para Athletics</SelectItem>
                        <SelectItem value="para-swimming">Para Swimming</SelectItem>
                        <SelectItem value="wheelchair-basketball">Wheelchair Basketball</SelectItem>
                        <SelectItem value="sitting-volleyball">Sitting Volleyball</SelectItem>
                        <SelectItem value="boccia">Sitting Volleyball</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Favorite Team / Country</Label>
                    <Select>
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Select team" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usa">Team USA</SelectItem>
                        <SelectItem value="gbr">Team GB</SelectItem>
                        <SelectItem value="fra">Team France</SelectItem>
                        <SelectItem value="aus">Team Australia</SelectItem>
                        <SelectItem value="jpn">Team Japan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-3 pt-6">
                  <Button className="h-12 w-full" onClick={nextStep}>
                    Save Profile & Submit Registration
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6 py-12"
              >
                <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-12 h-12" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Registration Complete!</h2>
                <p className="text-muted-foreground max-w-sm mx-auto text-lg">
                  You have successfully entered the LA28 OKC Locals Presale draw.
                </p>
                <Card className="bg-primary/5 border-primary/20 mt-6 text-left">
                  <CardContent className="pt-6">
                    <p className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Medal className="w-4 h-4 text-primary" /> What happens next?
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Please check your email inbox for a confirmation message detailing the next steps of the draw process. Good luck!
                    </p>
                  </CardContent>
                </Card>
                <div className="pt-8">
                  <Button variant="outline" className="h-12" onClick={() => setStep(0)}>
                    Back to Home
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Progress indicator */}
          {step > 0 && step < 4 && (
            <div className="mt-12 flex justify-center gap-2">
              {[1, 2, 3].map((i) => (
                <div 
                  key={i} 
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === step ? "w-8 bg-primary" : "w-2 bg-primary/20"
                  }`} 
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
