import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  )
}
