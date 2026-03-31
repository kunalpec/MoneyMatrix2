export default function FormInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  name,
  autoComplete,
  readOnly = false,
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        autoComplete={autoComplete}
        name={name}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        type={type}
        value={value}
      />
    </label>
  );
}
