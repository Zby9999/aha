import { cn } from "cn"
import { LoaderIcon, type IconProps } from "@/components/icons"

function Spinner({ className, ...props }: IconProps) {
  return (
    <LoaderIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
