export const Good = ({ label }: { label: string }) => (
  <box>
    <text>
      <b>{label}</b>
      <span>plain</span>
    </text>
    {label === "" ? null : <text>{label}</text>}
  </box>
);
