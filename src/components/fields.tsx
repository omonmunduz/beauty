import { TextInput, type TextInputProps } from '@astryxdesign/core/TextInput';
import { formatPhone } from '@/lib/validation';

const EXAMPLES: Record<string, string> = { '7': '+7 900 000-00-00', '996': '+996 700 000 000', '998': '+998 90 000 00 00', '375': '+375 29 000-00-00', '77': '+7 700 000 00 00' };

/** Example number in the studio's country, from the studio phone ("+996 …" → "+996 700 000 000"). */
export function phoneExample(studioPhone: string): string {
  const d = studioPhone.replace(/\D/g, '');
  for (const code of ['996', '998', '375', '77', '7']) if (d.startsWith(code)) return EXAMPLES[code]!;
  return '+7 900 000-00-00';
}

// Astryx TextInput forwards unknown DOM props to the <input>; inputMode is omitted from its
// public types, so it is passed through an untyped spread to get the numeric keypad on phones.
export function PhoneInput(props: Omit<TextInputProps, 'type'>) {
  const extra = { inputMode: 'tel', name: 'tel' } as object;
  return (
    <TextInput
      {...props}
      {...extra}
      autoComplete="tel"
      placeholder={props.placeholder}
      onBlur={(e) => {
        props.onChange?.(formatPhone(props.value), e as never);
        props.onBlur?.(e);
      }}
    />
  );
}

export function NumberField(props: Omit<TextInputProps, 'type'> & { decimal?: boolean }) {
  const { decimal, ...rest } = props;
  const extra = { inputMode: decimal ? 'decimal' : 'numeric' } as object;
  return <TextInput {...rest} {...extra} />;
}
