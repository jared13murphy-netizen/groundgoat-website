import { redirect } from 'next/navigation'

/** Products moved onto the map (owner 11/13): My Maps → Products opens the
 *  slide-out there. Old links land on the map. */
export default function ProductsPage() {
  redirect('/access')
}
