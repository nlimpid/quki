import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

/** Single-choice filter. Selection stays in the URL; this only renders the control. */
export function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([value])}
      size="sm"
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (typeof next === "string") onChange(next as T);
      }}
    >
      {options.map((option) => (
        <ToggleButton key={option.id} id={option.id}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
