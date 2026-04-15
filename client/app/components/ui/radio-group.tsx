import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Circle } from "lucide-react";

import { cn } from "~/lib/utils";

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("flex gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, children, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item> & { children?: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
      <RadioGroupPrimitive.Item
        data-slot="radio-group-item"
        className={cn(
          "aspect-square size-4 shrink-0 rounded-full border border-input text-primary focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <Circle className="size-2 fill-current text-current" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {children}
    </label>
  );
}

export { RadioGroup, RadioGroupItem };
