import { Router } from 'express'
import { rejectSuspendedStation } from '../middleware/rejectSuspendedStation.js'
import { requireAuth, requireOwnerOrStaff } from '../middleware/auth.js'
import { billingRouter } from './billing.js'
import { chatRouter } from './chat.js'
import { customersRouter } from './customers.js'
import { deliveriesRouter } from './deliveries.js'
import { inventoryRouter } from './inventory.js'
import { invitesRouter } from './invites.js'
import { paymentsRouter } from './payments.js'
import { productsRouter } from './products.js'
import { riderAppRouter } from './riderApp.js'
import { ridersRouter } from './riders.js'
import { settingsRouter } from './settings.js'
import { stationRouter } from './station.js'
import { syncRouter } from './sync.js'
import { utangRouter } from './utang.js'

/** Authenticated API surface — all routes require Bearer JWT with stationId. */
export const apiRouter = Router()

apiRouter.use(requireAuth)
apiRouter.use(rejectSuspendedStation)

/** Delivery rider field app (role=rider). */
apiRouter.use('/rider', riderAppRouter)

apiRouter.use(requireOwnerOrStaff)

apiRouter.get('/me', (req, res) => {
  res.json({ auth: req.auth })
})

apiRouter.use('/products', productsRouter)
apiRouter.use('/customers', customersRouter)
apiRouter.use('/riders', ridersRouter)
apiRouter.use('/deliveries', deliveriesRouter)
apiRouter.use('/utang', utangRouter)
apiRouter.use('/payments', paymentsRouter)
apiRouter.use('/settings', settingsRouter)
apiRouter.use('/inventory', inventoryRouter)
apiRouter.use('/sync', syncRouter)
apiRouter.use('/invites', invitesRouter)
apiRouter.use('/station', stationRouter)
apiRouter.use('/billing', billingRouter)
apiRouter.use('/chat', chatRouter)
