import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="shadow-[inset_0_0_0_1.5px_var(--danger)]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  )
}
