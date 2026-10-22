import * as SelectPrimitive from "@radix-ui/react-select";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode
} from "react";

import { cn } from "@/lib/utils";

const selectVariants = cva(
  "inline-flex min-w-0 items-center justify-between gap-3 border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-ethereum/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-ethereum/40",
  {
    variants: { variant: { pill: "rounded-full", field: "rounded-2xl" } },
    defaultVariants: { variant: "pill" }
  }
);

interface SelectProps
  extends ComponentPropsWithoutRef<typeof SelectPrimitive.Root>,
    Pick<
      ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
      | "id"
      | "aria-label"
      | "aria-labelledby"
      | "aria-describedby"
      | "aria-invalid"
      | "className"
      | "title"
    >,
    VariantProps<typeof selectVariants> {
  placeholder?: string;
  children: ReactNode;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      children,
      className,
      variant,
      placeholder,
      id,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      title,
      ...props
    },
    ref
  ) {
    const [portalContainer, setPortalContainer] = useState<HTMLElement>();
    const triggerRef = useCallback(
      (element: HTMLButtonElement | null) => {
        // Native dialogs occupy the browser's top layer. Keep their menus in that layer.
        setPortalContainer(element?.closest("dialog") ?? undefined);
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      },
      [ref]
    );
    return (
      <SelectPrimitive.Root {...props}>
        <SelectPrimitive.Trigger
          ref={triggerRef}
          id={id}
          title={title}
          data-select-value={props.value}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          className={cn(selectVariants({ variant }), className, "pr-4")}
        >
          <span className="min-w-0 truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown
              aria-hidden="true"
              size={16}
              className="shrink-0 text-muted"
              data-select-arrow=""
            />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal container={portalContainer}>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={8}
            collisionPadding={12}
            onEscapeKeyDown={(event) => event.stopPropagation()}
            className="z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-line bg-white p-1.5 text-ink shadow-card"
          >
            <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
              <ChevronUp aria-hidden="true" size={16} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
              <ChevronDown aria-hidden="true" size={16} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  }
);
Select.displayName = "Select";

export const SelectItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ children, className, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      {...props}
      data-select-value={props.value}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-xl py-2.5 pl-3 pr-10 text-sm font-semibold outline-none data-[state=checked]:bg-ethereum/10 data-[state=checked]:text-ethereum data-[highlighted]:bg-lavender/35 data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-3 flex items-center">
        <Check aria-hidden="true" size={16} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = "SelectItem";
